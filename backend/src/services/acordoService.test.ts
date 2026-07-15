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

/** Builds a fresh Task_Nova (no acordoAtualId) via an in-memory TaskRepository. */
async function criarTaskNova(taskRepository: InMemoryTaskRepository, titulo: string): Promise<Task> {
  return taskRepository.create({ titulo, ordemExibicao: 0 });
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

          const service = new AcordoService(
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

          const service = new AcordoService(
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

          const service = new AcordoService(
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
          // ainda não foi avaliado deve ser rejeitada
          await expect(
            service.registrarAcordo(taskNova.id, tipoAcordoIdTentativa),
          ).rejects.toThrow(ConflictError);

          // o Acordo_Atual existente permanece inalterado
          const taskDepois = await taskRepository.findById(taskNova.id);
          expect(taskDepois!.acordoAtualId).toBe(acordoAtual.id);

          // nenhum novo Acordo foi persistido para a Task
          const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(historico).toHaveLength(1);
          expect(historico[0]!.id).toBe(acordoAtual.id);
          expect(historico[0]!.estadoCumprimento).toBe('pendente');
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

          const service = new AcordoService(
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

          const service = new AcordoService(
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

      const service = new AcordoService(
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
      const cenarioComTipoExtra = new AcordoService(
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

      const service = new AcordoService(
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

      const service = new AcordoService(
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

      const service = new AcordoService(
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

    const service = new AcordoService(
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

  it('reinicia o contador quando o Acordo_Atual anterior "Avaliar e planejar" foi avaliado como não cumprido', async () => {
    const idAvaliarPlanejar = randomUUID();
    const { service, taskRepository, taskId } = await montarCenarioComTipos({
      [idAvaliarPlanejar]: NOME_AVALIAR_E_PLANEJAR,
    });

    await service.registrarAcordo(taskId, idAvaliarPlanejar);
    await service.avaliarAcordoAtual(taskId, 'cumprido');
    await service.registrarAcordo(taskId, idAvaliarPlanejar);

    const taskComUmaTentativa = await taskRepository.findById(taskId);
    expect(taskComUmaTentativa!.tentativasAvaliarPlanejar).toBe(1);

    // o próximo Acordo "Avaliar e planejar" é avaliado como não cumprido,
    // quebrando a cadeia de sucessos consecutivos
    await service.avaliarAcordoAtual(taskId, 'nao_cumprido');
    await service.registrarAcordo(taskId, idAvaliarPlanejar);

    const taskDepois = await taskRepository.findById(taskId);
    expect(taskDepois!.tentativasAvaliarPlanejar).toBe(0);
    // o não cumprimento incrementa numTentativas normalmente, sem relação com este contador
    expect(taskDepois!.numTentativas).toBe(1);
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

          const service = new AcordoService(
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

          const service = new AcordoService(
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

          const service = new AcordoService(
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

          const service = new AcordoService(
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

      const service = new AcordoService(
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

      const service = new AcordoService(
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

      const service = new AcordoService(
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

      const service = new AcordoService(
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

          const service = new AcordoService(
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

    const service = new AcordoService(
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
    const service = new AcordoService(
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
    const service = new AcordoService(
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

    const service = new AcordoService(
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

    const service = new AcordoService(
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

    const service = new AcordoService(
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

    const service = new AcordoService(
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

    const service = new AcordoService(
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

    const service = new AcordoService(
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

    const service = new AcordoService(
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

      const service = new AcordoService(
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

      const service = new AcordoService(
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

      const service = new AcordoService(
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

      const service = new AcordoService(
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
