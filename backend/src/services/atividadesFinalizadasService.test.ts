// Tests for AtividadesFinalizadasService.obterAtividadesFinalizadas.
//
// Exercises the domain/service layer against an in-memory fake of
// TaskRepository (exposing only the
// `listConcluidasWithAcordosEResponsavel` surface this service actually
// uses), keeping the runs fast and deterministic (per design.md "Testing
// Strategy": "Os testes de propriedade operam sobre a camada de
// domínio/serviços com persistência em memória ou mockada").

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { TaskRepository, TaskWithAcordosEResponsavel } from '../repositories/taskRepository.js';
import { AtividadesFinalizadasService } from './atividadesFinalizadasService.js';

/**
 * In-memory fake of TaskRepository exposing only
 * `listConcluidasWithAcordosEResponsavel`, the single method
 * `AtividadesFinalizadasService.obterAtividadesFinalizadas` reads from.
 */
class InMemoryTaskRepositoryComConcluidas {
  constructor(private readonly tasks: TaskWithAcordosEResponsavel[]) {}

  async listConcluidasWithAcordosEResponsavel(): Promise<TaskWithAcordosEResponsavel[]> {
    return this.tasks;
  }
}

/** Builds a concluída Task fake row with a "Finalizar" cumprido Acordo at `dataFinalizacao`. */
function taskFinalizadaFake(
  id: string,
  titulo: string,
  dataFinalizacao: Date,
  responsavelNome?: string,
): TaskWithAcordosEResponsavel {
  const acordoId = `acordo-${id}`;
  return {
    id,
    titulo,
    descricao: null,
    responsavelId: responsavelNome !== undefined ? `resp-${id}` : null,
    numTentativas: 0,
    tentativasAvaliarPlanejar: 0,
    ordemExibicao: 0,
    acordoAtualId: acordoId,
    concluida: true,
    criadaEm: new Date(dataFinalizacao.getTime() - 1000 * 60 * 60 * 24 * 7),
    responsavel: responsavelNome !== undefined ? { id: `resp-${id}`, nomeLogin: responsavelNome } : null,
    acordos: [
      {
        id: acordoId,
        taskId: id,
        tipoAcordoId: 'tipo-finalizar',
        dataRegistro: dataFinalizacao,
        estadoCumprimento: 'cumprido',
        motivoNaoCumprimentoId: null,
        tipoAcordo: { id: 'tipo-finalizar', nome: 'Finalizar' },
      },
    ],
  } as unknown as TaskWithAcordosEResponsavel;
}

describe('AtividadesFinalizadasService.obterAtividadesFinalizadas', () => {
  it('retorna as Tasks concluídas ordenadas por data de finalização descendente', async () => {
    const antiga = taskFinalizadaFake('t1', 'Antiga', new Date('2026-07-01T10:00:00Z'));
    const recente = taskFinalizadaFake('t2', 'Recente', new Date('2026-07-13T09:00:00Z'));
    const intermediaria = taskFinalizadaFake('t3', 'Intermediaria', new Date('2026-07-05T09:00:00Z'));

    const repository = new InMemoryTaskRepositoryComConcluidas([antiga, recente, intermediaria]);
    const service = new AtividadesFinalizadasService(
      repository as unknown as TaskRepository,
      () => new Date('2026-07-13T12:00:00Z'),
    );

    const atividades = await service.obterAtividadesFinalizadas();

    expect(atividades.map((a) => a.id)).toEqual(['t2', 't3', 't1']);
  });

  it('sinaliza finalizadaHoje apenas para Tasks finalizadas no dia calendário atual', async () => {
    const hoje = taskFinalizadaFake('t1', 'Hoje', new Date('2026-07-13T08:00:00Z'));
    const ontem = taskFinalizadaFake('t2', 'Ontem', new Date('2026-07-12T23:59:00Z'));

    const repository = new InMemoryTaskRepositoryComConcluidas([hoje, ontem]);
    const service = new AtividadesFinalizadasService(
      repository as unknown as TaskRepository,
      () => new Date('2026-07-13T20:00:00Z'),
    );

    const atividades = await service.obterAtividadesFinalizadas();

    const itemHoje = atividades.find((a) => a.id === 't1');
    const itemOntem = atividades.find((a) => a.id === 't2');

    expect(itemHoje?.finalizadaHoje).toBe(true);
    expect(itemOntem?.finalizadaHoje).toBe(false);
  });

  it('inclui título e Responsável (quando definido) em cada item', async () => {
    const comResponsavel = taskFinalizadaFake('t1', 'Com Responsável', new Date('2026-07-13T08:00:00Z'), 'alice');
    const semResponsavel = taskFinalizadaFake('t2', 'Sem Responsável', new Date('2026-07-13T08:00:00Z'));

    const repository = new InMemoryTaskRepositoryComConcluidas([comResponsavel, semResponsavel]);
    const service = new AtividadesFinalizadasService(repository as unknown as TaskRepository);

    const atividades = await service.obterAtividadesFinalizadas();

    const item1 = atividades.find((a) => a.id === 't1');
    const item2 = atividades.find((a) => a.id === 't2');

    expect(item1?.titulo).toBe('Com Responsável');
    expect(item1?.responsavelNome).toBe('alice');
    expect(item2?.titulo).toBe('Sem Responsável');
    expect(item2?.responsavelNome).toBeUndefined();
  });

  it('usa a data de registro do Acordo "Finalizar" cumprido mais recente quando há múltiplos no histórico', async () => {
    const task = taskFinalizadaFake('t1', 'Task', new Date('2026-07-10T08:00:00Z'));
    // Adiciona um segundo Acordo "Finalizar" cumprido mais antigo, e um
    // Acordo de outro tipo mais recente que não deve ser considerado.
    const taskComHistoricoExtra: TaskWithAcordosEResponsavel = {
      ...task,
      acordos: [
        {
          id: 'acordo-antigo',
          taskId: 't1',
          tipoAcordoId: 'tipo-finalizar',
          dataRegistro: new Date('2026-07-01T08:00:00Z'),
          estadoCumprimento: 'cumprido',
          motivoNaoCumprimentoId: null,
          tipoAcordo: { id: 'tipo-finalizar', nome: 'Finalizar' },
        },
        ...task.acordos,
        {
          id: 'acordo-outro-tipo',
          taskId: 't1',
          tipoAcordoId: 'tipo-outro',
          dataRegistro: new Date('2026-07-12T08:00:00Z'),
          estadoCumprimento: 'cumprido',
          motivoNaoCumprimentoId: null,
          tipoAcordo: { id: 'tipo-outro', nome: 'Avaliar e planejar' },
        },
      ],
    } as unknown as TaskWithAcordosEResponsavel;

    const repository = new InMemoryTaskRepositoryComConcluidas([taskComHistoricoExtra]);
    const service = new AtividadesFinalizadasService(repository as unknown as TaskRepository);

    const atividades = await service.obterAtividadesFinalizadas();

    expect(atividades[0]?.dataFinalizacao).toEqual(new Date('2026-07-10T08:00:00Z'));
  });

  // Property: toda Task concluída retornada pelo repositório aparece
  // exatamente uma vez no resultado, e a ordenação é sempre não-crescente
  // por data de finalização.
  it('Feature: daily-agreements, Property: exaustividade e ordenação por data de finalização', async () => {
    const specArb = fc.record({
      id: fc.uuid(),
      titulo: fc.string({ minLength: 1, maxLength: 100 }),
      dataFinalizacao: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
    });

    const specsArb = fc.array(specArb, { minLength: 0, maxLength: 30 }).map((specs) => {
      const seen = new Set<string>();
      return specs.filter((spec) => {
        if (seen.has(spec.id)) return false;
        seen.add(spec.id);
        return true;
      });
    });

    await fc.assert(
      fc.asyncProperty(specsArb, async (specs) => {
        const tasks = specs.map((spec) => taskFinalizadaFake(spec.id, spec.titulo, spec.dataFinalizacao));
        const repository = new InMemoryTaskRepositoryComConcluidas(tasks);
        const service = new AtividadesFinalizadasService(repository as unknown as TaskRepository);

        const atividades = await service.obterAtividadesFinalizadas();

        // exaustividade: mesmo conjunto de ids, sem perda nem duplicação.
        expect(new Set(atividades.map((a) => a.id))).toEqual(new Set(specs.map((s) => s.id)));
        expect(atividades).toHaveLength(specs.length);

        // ordenação não-crescente por data de finalização.
        for (let i = 1; i < atividades.length; i++) {
          expect(atividades[i]!.dataFinalizacao.getTime()).toBeLessThanOrEqual(
            atividades[i - 1]!.dataFinalizacao.getTime(),
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
