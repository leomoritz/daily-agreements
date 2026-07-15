// Property-based tests for TaskService.criarTask (task 4.2).
//
// These tests exercise the domain/service layer against an in-memory fake
// of TaskRepository and the Cadastro_de_Usuários lookup, keeping the
// property runs fast and deterministic (per design.md "Testing Strategy":
// "Os testes de propriedade operam sobre a camada de domínio/serviços com
// persistência em memória ou mockada").

import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { Acordo, Task } from '../../generated/prisma/index.js';
import type {
  AcordoCreateData,
  AcordoRepository,
  AcordoUpdateData,
} from '../repositories/acordoRepository.js';
import type { CadastroRepository } from '../repositories/cadastroRepository.js';
import type {
  TaskCreateData,
  TaskRepository,
  TaskUpdateData,
} from '../repositories/taskRepository.js';
import { AcordoService } from './acordoService.js';
import { NotFoundError, ValidationError } from './errors.js';
import { TaskService } from './taskService.js';

/**
 * In-memory fake of TaskRepository, exposing the same public surface
 * (create/findById/update/delete/listActive) used by TaskService, without
 * touching Prisma/SQLite.
 */
class InMemoryTaskRepository {
  private readonly tasks = new Map<string, Task>();

  async create(data: TaskCreateData): Promise<Task> {
    const task: Task = {
      id: randomUUID(),
      titulo: data.titulo,
      descricao: data.descricao ?? null,
      responsavelId: data.responsavelId ?? null,
      numTentativas: data.numTentativas ?? 0,
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
}

/** In-memory fake of the Cadastro_de_Usuários lookup used by TaskService. */
class InMemoryUsuarioCadastradoRepository
  implements Pick<CadastroRepository<{ id: string }, unknown>, 'findById'>
{
  private readonly usuarios: Set<string>;

  constructor(usuarioIds: string[] = []) {
    this.usuarios = new Set(usuarioIds);
  }

  async findById(id: string): Promise<{ id: string } | null> {
    return this.usuarios.has(id) ? { id } : null;
  }
}

/**
 * In-memory fake of AcordoRepository, exposing the same public surface used
 * by AcordoService/TaskService (create/findById/findHistoryByTaskId/update).
 * Mirrors the fake used in acordoService.test.ts, so both services can be
 * wired to the same shared instance in these tests.
 */
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

  /**
   * Test-only helper (not part of the real AcordoRepository surface) used
   * to model, at the fake level, the DB-level cascade delete that removes
   * every Acordo of a Task when that Task is physically deleted
   * (Requirement 9.4). See `InMemoryTaskRepositoryComCascata` below.
   */
  async deleteByTaskId(taskId: string): Promise<void> {
    for (const [id, acordo] of this.acordos) {
      if (acordo.taskId === taskId) {
        this.acordos.delete(id);
      }
    }
  }
}

/**
 * Test-only wrapper around `InMemoryTaskRepository` that, on `delete`,
 * also cascades the deletion to every Acordo of that Task in the given
 * `InMemoryAcordoRepository` — mirroring, at the fake level, the DB-level
 * cascade the real repository relies on (see taskRepository.test.ts).
 */
class InMemoryTaskRepositoryComCascata extends InMemoryTaskRepository {
  constructor(private readonly acordoRepository: InMemoryAcordoRepository) {
    super();
  }

  override async delete(id: string): Promise<void> {
    await super.delete(id);
    await this.acordoRepository.deleteByTaskId(id);
  }
}

/** In-memory fake of a CadastroRepository lookup (Tipo_de_Acordo), exposing only `findById`. */
class InMemoryCadastroLookup implements Pick<CadastroRepository<{ id: string }, unknown>, 'findById'> {
  private readonly ids: Set<string>;

  constructor(ids: string[] = []) {
    this.ids = new Set(ids);
  }

  async findById(id: string): Promise<{ id: string } | null> {
    return this.ids.has(id) ? { id } : null;
  }
}

/** Any string whose trim() has between 1 and 200 characters (Requirement 1.1). */
const validTituloArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length >= 1);

/** Any string whose trim() results in an empty string (Requirement 1.2). */
const tituloVazioAposTrimArb = fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), {
  maxLength: 20,
});

/**
 * Any string whose trim() exceeds 200 characters (Requirement 1.3). Built
 * from non-whitespace characters only, so trim() never shrinks the length
 * below the generated size.
 */
const tituloExcedeLimiteArb = fc
  .array(
    fc.char().filter((c) => c.trim().length > 0),
    { minLength: 201, maxLength: 250 },
  )
  .map((chars) => chars.join(''));

/** Any título that `criarTask` must reject: trim empty or trim > 200 chars. */
const tituloInvalidoArb = fc.oneof(tituloVazioAposTrimArb, tituloExcedeLimiteArb);

/**
 * Any string whose trim() has at most 2000 characters (Requirement 1.5).
 * Built by capping the generated length at 2000: since trim() never
 * increases length, the trimmed result is guaranteed to stay within the
 * limit as well.
 */
const descricaoDentroDoLimiteArb = fc.string({ maxLength: 2000 });

/**
 * Any string whose trim() exceeds 2000 characters (Requirement 1.6). Built
 * from non-whitespace characters only, so trim() never shrinks the length
 * below the generated size.
 */
const descricaoExcedeLimiteArb = fc
  .array(
    fc.char().filter((c) => c.trim().length > 0),
    { minLength: 2001, maxLength: 2100 },
  )
  .map((chars) => chars.join(''));

describe('TaskService.criarTask', () => {
  // Property 1: Criação válida de Task
  // Validates: Requirements 1.1, 1.4, 1.9
  it('Feature: daily-agreements, Property 1: Criação válida de Task', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(validTituloArb, { minLength: 1, maxLength: 20 }), async (titulos) => {
        const taskRepository = new InMemoryTaskRepository() as unknown as TaskRepository;
        const usuarioRepository = new InMemoryUsuarioCadastradoRepository();
        const service = new TaskService(taskRepository, usuarioRepository);

        const createdIds = new Set<string>();

        for (const titulo of titulos) {
          const task = await service.criarTask({ titulo });

          // título igual ao resultado do trim (Requirement 1.1)
          expect(task.titulo).toBe(titulo.trim());
          // numTentativas = 0 (Requirement 1.9)
          expect(task.numTentativas).toBe(0);
          // classificada como Task_Nova: sem acordoAtualId (Requirement 8.1/8.2 basis)
          expect(task.acordoAtualId).toBeFalsy();
          // identificador nunca coincide com o de nenhuma outra Task já criada (Requirement 1.4)
          expect(createdIds.has(task.id)).toBe(false);
          createdIds.add(task.id);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Property 2: Rejeição de título inválido na criação
  // Validates: Requirements 1.2, 1.3
  it('Feature: daily-agreements, Property 2: Rejeição de título inválido na criação', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validTituloArb, { minLength: 0, maxLength: 10 }),
        tituloInvalidoArb,
        async (titulosExistentes, tituloInvalido) => {
          const taskRepository = new InMemoryTaskRepository() as unknown as TaskRepository;
          const usuarioRepository = new InMemoryUsuarioCadastradoRepository();
          const service = new TaskService(taskRepository, usuarioRepository);

          // popula a lista com Tasks válidas existentes antes da tentativa inválida
          for (const titulo of titulosExistentes) {
            await service.criarTask({ titulo });
          }

          const tasksAntes = await taskRepository.listActive();

          await expect(service.criarTask({ titulo: tituloInvalido })).rejects.toThrow(
            ValidationError,
          );

          const tasksDepois = await taskRepository.listActive();

          // a lista de Tasks existente permanece, em quantidade e conteúdo, inalterada
          expect(tasksDepois.length).toBe(tasksAntes.length);
          expect(tasksDepois).toEqual(tasksAntes);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 3: Limite de comprimento da descrição
  // Validates: Requirements 1.5, 1.6
  it('Feature: daily-agreements, Property 3: Limite de comprimento da descrição', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTituloArb,
        fc.oneof(descricaoDentroDoLimiteArb, descricaoExcedeLimiteArb),
        async (titulo, descricao) => {
          const taskRepository = new InMemoryTaskRepository() as unknown as TaskRepository;
          const usuarioRepository = new InMemoryUsuarioCadastradoRepository();
          const service = new TaskService(taskRepository, usuarioRepository);

          const descricaoAposTrim = descricao.trim();

          if (descricaoAposTrim.length <= 2000) {
            // descrição dentro do limite: a Task é criada armazenando essa descrição
            const task = await service.criarTask({ titulo, descricao });
            expect(task.descricao).toBe(descricaoAposTrim || null);
          } else {
            // descrição excede o limite: a criação é rejeitada
            const tasksAntes = await taskRepository.listActive();

            await expect(service.criarTask({ titulo, descricao })).rejects.toThrow(
              ValidationError,
            );

            const tasksDepois = await taskRepository.listActive();
            expect(tasksDepois.length).toBe(tasksAntes.length);
            expect(tasksDepois).toEqual(tasksAntes);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 4: Validação de Responsável na criação
  // Validates: Requirements 1.7, 1.8
  it('Feature: daily-agreements, Property 4: Validação de Responsável na criação', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTituloArb,
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.nat(),
        fc.uuid(),
        fc.boolean(),
        async (titulo, registeredIds, pickIndex, randomId, useValid) => {
          const taskRepository = new InMemoryTaskRepository() as unknown as TaskRepository;
          const usuarioRepository = new InMemoryUsuarioCadastradoRepository(registeredIds);
          const service = new TaskService(taskRepository, usuarioRepository);

          if (useValid) {
            // Responsável corresponde a um Usuário_Cadastrado existente
            // (Requirement 1.7): a Task criada deve referenciá-lo.
            const responsavelId = registeredIds[pickIndex % registeredIds.length];

            const task = await service.criarTask({ titulo, responsavelId });

            expect(task.responsavelId).toBe(responsavelId);
          } else {
            // Responsável não corresponde a nenhum Usuário_Cadastrado
            // existente (Requirement 1.8): a criação deve ser rejeitada e
            // a lista de Tasks deve permanecer inalterada.
            const responsavelId = registeredIds.includes(randomId)
              ? `${randomId}-invalido`
              : randomId;

            const tasksAntes = await taskRepository.listActive();

            await expect(service.criarTask({ titulo, responsavelId })).rejects.toThrow(
              ValidationError,
            );

            const tasksDepois = await taskRepository.listActive();
            expect(tasksDepois.length).toBe(tasksAntes.length);
            expect(tasksDepois).toEqual(tasksAntes);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property-based test for TaskService.buscarHistorico (task 10.2).
//
// Wires TaskService and AcordoService to the SAME in-memory fakes
// (InMemoryTaskRepository/InMemoryAcordoRepository) so that Acordo
// registrations/evaluations performed via AcordoService are visible to
// TaskService.buscarHistorico, which reads through AcordoRepository.
describe('TaskService.buscarHistorico', () => {
  // Property 19: Histórico completo e ordenado
  // Validates: Requirements 7.1, 7.2, 7.4
  it('Feature: daily-agreements, Property 19: Histórico completo e ordenado', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTituloArb,
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.record({
            tipoIndex: fc.nat({ max: 4 }),
            resultado: fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
          }),
          { minLength: 0, maxLength: 15 },
        ),
        async (titulo, tiposAcordoIds, registros) => {
          const taskRepository = new InMemoryTaskRepository() as unknown as TaskRepository;
          const acordoRepository = new InMemoryAcordoRepository() as unknown as AcordoRepository;
          const usuarioRepository = new InMemoryUsuarioCadastradoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup(tiposAcordoIds);

          // Clock injetável, estritamente crescente a cada chamada, para que a
          // ordem de dataRegistro corresponda de forma determinística à ordem
          // em que os Acordos foram efetivamente registrados.
          let contadorClock = 0;
          const clock = () => new Date(2020, 0, 1, 0, 0, 0, contadorClock++);

          const taskService = new TaskService(taskRepository, usuarioRepository, acordoRepository);
          const acordoService = new AcordoService(
            taskRepository,
            acordoRepository,
            tipoAcordoRepository,
            usuarioRepository,
            clock,
          );

          const task = await taskService.criarTask({ titulo });

          // Caso vazio: Task recém-criada, sem nenhum Acordo jamais registrado,
          // deve ter histórico igual a uma lista vazia (Requirement 7.4).
          expect(await taskService.buscarHistorico(task.id)).toEqual([]);

          const acordosRegistrados: Acordo[] = [];
          for (let i = 0; i < registros.length; i += 1) {
            const { tipoIndex, resultado } = registros[i]!;
            const tipoAcordoId = tiposAcordoIds[tipoIndex % tiposAcordoIds.length]!;

            // registra o próximo Acordo (primeiro, se i === 0; substituindo o
            // Acordo_Atual já avaliado, caso contrário) — Requirements 2.1, 5.1-5.3
            const acordo = await acordoService.registrarAcordo(task.id, tipoAcordoId);
            acordosRegistrados.push(acordo);

            // avalia o Acordo_Atual para permitir o próximo registro da
            // sequência; o último Acordo da sequência pode permanecer
            // pendente (o histórico deve incluí-lo do mesmo jeito).
            if (i < registros.length - 1) {
              await acordoService.avaliarAcordoAtual(task.id, resultado);
            }
          }

          const historico = await taskService.buscarHistorico(task.id);

          // o histórico contém exatamente todos os Acordos já registrados —
          // incluindo o Acordo_Atual, se houver, e todos os substituídos —
          // sem perda nem duplicação (Requirements 7.1, 7.3).
          expect(historico).toHaveLength(acordosRegistrados.length);
          expect(historico.map((a) => a.id).sort()).toEqual(
            acordosRegistrados.map((a) => a.id).sort(),
          );

          // cada item do histórico carrega Tipo_de_Acordo, data de registro e
          // estado de cumprimento (Requirement 7.2).
          for (const acordo of historico) {
            expect(acordo.tipoAcordoId).toBeTruthy();
            expect(acordo.dataRegistro).toBeInstanceOf(Date);
            expect(['pendente', 'cumprido', 'nao_cumprido']).toContain(acordo.estadoCumprimento);
          }

          // ordenado por dataRegistro do mais antigo para o mais recente
          // (Requirement 7.1), o que — dado o clock estritamente crescente —
          // corresponde exatamente à ordem em que os Acordos foram registrados.
          for (let i = 1; i < historico.length; i += 1) {
            expect(historico[i]!.dataRegistro.getTime()).toBeGreaterThan(
              historico[i - 1]!.dataRegistro.getTime(),
            );
          }
          expect(historico.map((a) => a.id)).toEqual(acordosRegistrados.map((a) => a.id));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property-based test for TaskService.editarTask (task 11.2).
describe('TaskService.editarTask', () => {
  // Property 22: Edição de título
  // Validates: Requirements 9.1, 9.2
  it('Feature: daily-agreements, Property 22: Edição de título', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTituloArb,
        fc.oneof(validTituloArb, tituloInvalidoArb),
        async (tituloOriginal, novoTitulo) => {
          const taskRepository = new InMemoryTaskRepository() as unknown as TaskRepository;
          const usuarioRepository = new InMemoryUsuarioCadastradoRepository();
          const service = new TaskService(taskRepository, usuarioRepository);

          const task = await service.criarTask({ titulo: tituloOriginal });
          const tituloOriginalArmazenado = task.titulo;

          const novoTituloAposTrim = novoTitulo.trim();

          if (novoTituloAposTrim.length >= 1 && novoTituloAposTrim.length <= 200) {
            // novo título válido: a Task é atualizada com o valor após trim
            // (Requirement 9.1)
            const editada = await service.editarTask(task.id, { titulo: novoTitulo });
            expect(editada.titulo).toBe(novoTituloAposTrim);

            const armazenada = await taskRepository.findById(task.id);
            expect(armazenada?.titulo).toBe(novoTituloAposTrim);
          } else {
            // novo título inválido (trim vazio ou > 200 caracteres): a edição
            // é rejeitada e o título anterior é preservado (Requirement 9.2)
            await expect(service.editarTask(task.id, { titulo: novoTitulo })).rejects.toThrow(
              ValidationError,
            );

            const armazenada = await taskRepository.findById(task.id);
            expect(armazenada?.titulo).toBe(tituloOriginalArmazenado);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 24: Edição de Responsável
  // Validates: Requirements 9.6, 9.7
  it('Feature: daily-agreements, Property 24: Edição de Responsável', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTituloArb,
        fc.array(fc.uuid(), { minLength: 2, maxLength: 5 }),
        fc.boolean(),
        fc.nat(),
        fc.constantFrom<'vazio' | 'valido' | 'invalido'>('vazio', 'valido', 'invalido'),
        fc.nat(),
        fc.uuid(),
        fc.constantFrom<string | null>(null, '', '   '),
        async (
          titulo,
          registeredIds,
          temResponsavelInicial,
          indiceInicial,
          ramo,
          indiceNovo,
          candidatoInvalido,
          valorVazio,
        ) => {
          const taskRepository = new InMemoryTaskRepository() as unknown as TaskRepository;
          const usuarioRepository = new InMemoryUsuarioCadastradoRepository(registeredIds);
          const service = new TaskService(taskRepository, usuarioRepository);

          // Task criada com ou sem um Responsável inicial válido.
          const responsavelInicialId = temResponsavelInicial
            ? registeredIds[indiceInicial % registeredIds.length]
            : undefined;
          const task = await service.criarTask({ titulo, responsavelId: responsavelInicialId });
          const responsavelAntes = task.responsavelId;

          if (ramo === 'vazio') {
            // valor vazio (null ou string que resulta em vazio após trim): o
            // Responsável atual é atualizado para "não definido", mesmo que
            // já não houvesse um Responsável antes (Requirement 9.6).
            const editada = await service.editarTask(task.id, { responsavelId: valorVazio });
            expect(editada.responsavelId).toBeFalsy();

            const armazenada = await taskRepository.findById(task.id);
            expect(armazenada?.responsavelId).toBeFalsy();
          } else if (ramo === 'valido') {
            // valor correspondente a um Usuário_Cadastrado existente: o
            // Responsável atual é atualizado para essa referência
            // (Requirement 9.6).
            const novoResponsavelId = registeredIds[indiceNovo % registeredIds.length]!;

            const editada = await service.editarTask(task.id, { responsavelId: novoResponsavelId });
            expect(editada.responsavelId).toBe(novoResponsavelId);

            const armazenada = await taskRepository.findById(task.id);
            expect(armazenada?.responsavelId).toBe(novoResponsavelId);
          } else {
            // valor não vazio que não corresponde a nenhum Usuário_Cadastrado
            // existente: a edição é rejeitada e o Responsável anterior é
            // preservado (Requirement 9.7).
            const responsavelIdInvalido = registeredIds.includes(candidatoInvalido)
              ? `${candidatoInvalido}-invalido`
              : candidatoInvalido;

            await expect(
              service.editarTask(task.id, { responsavelId: responsavelIdInvalido }),
            ).rejects.toThrow(ValidationError);

            const armazenada = await taskRepository.findById(task.id);
            expect(armazenada?.responsavelId).toBe(responsavelAntes);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property-based test for TaskService.removerTask (task 11.6).
//
// Wires TaskService and AcordoService to the same in-memory fakes, using
// `InMemoryTaskRepositoryComCascata` so that removing a Task also removes
// (in-memory) its Acordo history — mirroring the DB-level cascade the real
// repository relies on (Requirement 9.4).
describe('TaskService.removerTask', () => {
  // Property 23: Remoção manual é permanente
  // Validates: Requirements 9.4
  it('Feature: daily-agreements, Property 23: Remoção manual é permanente', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTituloArb,
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.record({
            tipoIndex: fc.nat({ max: 4 }),
            resultado: fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        async (titulo, tiposAcordoIds, registros) => {
          const acordoRepositoryFake = new InMemoryAcordoRepository();
          const taskRepository = new InMemoryTaskRepositoryComCascata(
            acordoRepositoryFake,
          ) as unknown as TaskRepository;
          const acordoRepository = acordoRepositoryFake as unknown as AcordoRepository;
          const usuarioRepository = new InMemoryUsuarioCadastradoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup(tiposAcordoIds);

          let contadorClock = 0;
          const clock = () => new Date(2020, 0, 1, 0, 0, 0, contadorClock++);

          const taskService = new TaskService(taskRepository, usuarioRepository, acordoRepository);
          const acordoService = new AcordoService(
            taskRepository,
            acordoRepository,
            tipoAcordoRepository,
            usuarioRepository,
            clock,
          );

          const task = await taskService.criarTask({ titulo });

          // constrói algum histórico de Acordos para a Task (opcional).
          for (let i = 0; i < registros.length; i += 1) {
            const { tipoIndex, resultado } = registros[i]!;
            const tipoAcordoId = tiposAcordoIds[tipoIndex % tiposAcordoIds.length]!;

            await acordoService.registrarAcordo(task.id, tipoAcordoId);

            if (i < registros.length - 1) {
              await acordoService.avaliarAcordoAtual(task.id, resultado);
            }
          }

          // pré-condição: a Task existe e, se houve registros, seu histórico
          // não está vazio.
          expect(await taskRepository.findById(task.id)).not.toBeNull();
          if (registros.length > 0) {
            expect(await taskService.buscarHistorico(task.id)).not.toHaveLength(0);
          }

          await taskService.removerTask(task.id);

          // a Task deixa de existir (Requirement 9.4).
          expect(await taskRepository.findById(task.id)).toBeNull();

          // seu histórico inteiro de Acordos deixa de ser retornado por
          // qualquer consulta subsequente (Requirement 9.4) — modelado aqui
          // pelo cascade no fake do AcordoRepository.
          expect(await acordoRepository.findHistoryByTaskId(task.id)).toEqual([]);

          // a Task e seu histórico deixam de ser recuperáveis via a API
          // pública do serviço.
          await expect(taskService.buscarHistorico(task.id)).rejects.toThrow(NotFoundError);

          // removê-la novamente também é rejeitado, pois já não existe.
          await expect(taskService.removerTask(task.id)).rejects.toThrow(NotFoundError);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property-based test for TaskService.reordenarTask (task 11.7).
describe('TaskService.reordenarTask', () => {
  // Property 32: Reordenação manual atualiza e persiste a ordem
  // Validates: Requirements 14.1, 14.2
  it('Feature: daily-agreements, Property 32: Reordenação manual atualiza e persiste a ordem', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validTituloArb, { minLength: 1, maxLength: 10 }),
        fc.nat(),
        fc.integer({ min: -5, max: 15 }),
        async (titulos, pickIndex, novaPosicaoBruta) => {
          const taskRepository = new InMemoryTaskRepository() as unknown as TaskRepository;
          const usuarioRepository = new InMemoryUsuarioCadastradoRepository();
          const service = new TaskService(taskRepository, usuarioRepository);

          for (const titulo of titulos) {
            await service.criarTask({ titulo });
          }

          const tasksAntes = (await taskRepository.listActive()).sort(
            (a, b) => a.ordemExibicao - b.ordemExibicao,
          );

          const taskMovidaId = tasksAntes[pickIndex % tasksAntes.length]!.id;
          const outrasIdsAntes = tasksAntes
            .filter((t) => t.id !== taskMovidaId)
            .map((t) => t.id);

          await service.reordenarTask(taskMovidaId, novaPosicaoBruta);

          // posição de destino esperada, clampada ao intervalo válido
          // [0, length - 1] (Requirement 14.1)
          const posicaoEsperada = Math.min(
            Math.max(novaPosicaoBruta, 0),
            tasksAntes.length - 1,
          );

          const lerEVerificar = async (): Promise<string[]> => {
            const tasksDepois = (await taskRepository.listActive()).sort(
              (a, b) => a.ordemExibicao - b.ordemExibicao,
            );

            // a Task movida passa a ocupar exatamente a posição de destino
            // (já clampada), e a ordem relativa das demais Tasks é
            // preservada (Requirement 14.1).
            expect(tasksDepois[posicaoEsperada]!.id).toBe(taskMovidaId);

            const outrasIdsDepois = tasksDepois
              .filter((t) => t.id !== taskMovidaId)
              .map((t) => t.id);
            expect(outrasIdsDepois).toEqual(outrasIdsAntes);

            return tasksDepois.map((t) => t.id);
          };

          const ordemAposReordenar = await lerEVerificar();

          // a nova ordem permanece refletida em consultas subsequentes, sem
          // que uma nova reordenação, registro em lote ou remoção tenha
          // ocorrido (Requirement 14.2).
          const ordemSegundaLeitura = await lerEVerificar();
          const ordemTerceiraLeitura = await lerEVerificar();

          expect(ordemSegundaLeitura).toEqual(ordemAposReordenar);
          expect(ordemTerceiraLeitura).toEqual(ordemAposReordenar);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property-based test for Task-scoped operations against a non-existent
// Task identifier (task 11.9), spanning both TaskService and
// AcordoService. Wires both services to the same in-memory fakes (with
// cascade delete modeled, as in the `TaskService.removerTask` describe
// block above) so a shared fixture of real Tasks (with Acordo history)
// can be used to prove the system's state stays unchanged across all five
// rejected attempts.
describe('Operações sobre Task inexistente (cross-service)', () => {
  // Property 7: Operações sobre Task inexistente são rejeitadas
  // Validates: Requirements 2.4, 7.5, 9.3, 9.5, 14.3
  it('Feature: daily-agreements, Property 7: Operações sobre Task inexistente são rejeitadas', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            titulo: validTituloArb,
            registros: fc.array(
              fc.record({
                tipoIndex: fc.nat({ max: 4 }),
                resultado: fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
              }),
              { minLength: 0, maxLength: 5 },
            ),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        async (fixtures, tiposAcordoIds) => {
          const acordoRepositoryFake = new InMemoryAcordoRepository();
          const taskRepository = new InMemoryTaskRepositoryComCascata(
            acordoRepositoryFake,
          ) as unknown as TaskRepository;
          const acordoRepository = acordoRepositoryFake as unknown as AcordoRepository;
          const usuarioRepository = new InMemoryUsuarioCadastradoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup(tiposAcordoIds);

          let contadorClock = 0;
          const clock = () => new Date(2020, 0, 1, 0, 0, 0, contadorClock++);

          const taskService = new TaskService(taskRepository, usuarioRepository, acordoRepository);
          const acordoService = new AcordoService(
            taskRepository,
            acordoRepository,
            tipoAcordoRepository,
            usuarioRepository,
            clock,
          );

          // monta o fixture: algumas Tasks reais e existentes, cada uma com
          // algum histórico de Acordos (eventualmente vazio).
          for (const { titulo, registros } of fixtures) {
            const task = await taskService.criarTask({ titulo });
            for (let i = 0; i < registros.length; i += 1) {
              const { tipoIndex, resultado } = registros[i]!;
              const tipoAcordoId = tiposAcordoIds[tipoIndex % tiposAcordoIds.length]!;
              await acordoService.registrarAcordo(task.id, tipoAcordoId);
              if (i < registros.length - 1) {
                await acordoService.avaliarAcordoAtual(task.id, resultado);
              }
            }
          }

          // identificador que não corresponde a nenhuma Task existente no fixture.
          const existingIds = new Set((await taskRepository.listActive()).map((t) => t.id));
          let taskIdInexistente = randomUUID();
          while (existingIds.has(taskIdInexistente)) {
            taskIdInexistente = randomUUID();
          }

          // snapshot do estado do sistema (Tasks ativas e histórico de Acordos
          // de cada uma) antes de qualquer tentativa sobre a Task inexistente.
          const tasksAntes = [...(await taskRepository.listActive())].sort((a, b) =>
            a.id.localeCompare(b.id),
          );
          const historicosAntes = new Map<string, Acordo[]>();
          for (const task of tasksAntes) {
            historicosAntes.set(task.id, await acordoRepository.findHistoryByTaskId(task.id));
          }

          const verificarEstadoInalterado = async () => {
            const tasksDepois = [...(await taskRepository.listActive())].sort((a, b) =>
              a.id.localeCompare(b.id),
            );
            // o conjunto de Tasks existentes permanece, em quantidade e
            // conteúdo, exatamente o mesmo.
            expect(tasksDepois).toEqual(tasksAntes);

            // o histórico de Acordos de cada Task real permanece inalterado.
            for (const task of tasksAntes) {
              const historicoDepois = await acordoRepository.findHistoryByTaskId(task.id);
              expect(historicoDepois).toEqual(historicosAntes.get(task.id));
            }
          };

          // registrar Acordo sobre Task inexistente (Requirement 2.4)
          await expect(
            acordoService.registrarAcordo(taskIdInexistente, tiposAcordoIds[0]!),
          ).rejects.toThrow(NotFoundError);
          await verificarEstadoInalterado();

          // consultar histórico de Task inexistente (Requirement 7.5)
          await expect(taskService.buscarHistorico(taskIdInexistente)).rejects.toThrow(
            NotFoundError,
          );
          await verificarEstadoInalterado();

          // editar título/Responsável de Task inexistente (Requirement 9.3)
          await expect(
            taskService.editarTask(taskIdInexistente, { titulo: 'Novo título' }),
          ).rejects.toThrow(NotFoundError);
          await verificarEstadoInalterado();

          // remover Task inexistente (Requirement 9.5)
          await expect(taskService.removerTask(taskIdInexistente)).rejects.toThrow(
            NotFoundError,
          );
          await verificarEstadoInalterado();

          // reordenar Task inexistente (Requirement 14.3)
          await expect(taskService.reordenarTask(taskIdInexistente, 0)).rejects.toThrow(
            NotFoundError,
          );
          await verificarEstadoInalterado();
        },
      ),
      { numRuns: 100 },
    );
  });
});
