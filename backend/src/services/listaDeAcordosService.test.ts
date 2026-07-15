// Property-based test for ListaDeAcordosService.obterLista (task 15.2).
//
// Exercises the domain/service layer against an in-memory fake of
// TaskRepository (exposing only the `listActiveWithAcordoAtualEResponsavel`
// surface `ListaDeAcordosService` actually uses), keeping the property runs
// fast and deterministic (per design.md "Testing Strategy": "Os testes de
// propriedade operam sobre a camada de domínio/serviços com persistência em
// memória ou mockada").

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { TaskRepository, TaskWithAcordoAtualEResponsavel } from '../repositories/taskRepository.js';
import { ListaDeAcordosService, type TaskComAcordoItem } from './listaDeAcordosService.js';

/**
 * In-memory fake of TaskRepository exposing only
 * `listActiveWithAcordoAtualEResponsavel`, the single method
 * `ListaDeAcordosService.obterLista` reads from. Returns whatever fixed
 * list of already-joined Tasks is handed to it, letting the tests build
 * arbitrary Task_Nova / Task_Com_Acordo mixes directly.
 */
class InMemoryTaskRepositoryComLista {
  constructor(private readonly tasks: TaskWithAcordoAtualEResponsavel[]) {}

  async listActiveWithAcordoAtualEResponsavel(): Promise<TaskWithAcordoAtualEResponsavel[]> {
    return this.tasks;
  }
}

/** Builds a Task_Nova (no Acordo_Atual) fake row with the given id. */
function taskNovaFake(id: string, ordemExibicao: number): TaskWithAcordoAtualEResponsavel {
  return {
    id,
    titulo: `Task ${id}`,
    descricao: null,
    responsavelId: null,
    numTentativas: 0,
    ordemExibicao,
    acordoAtualId: null,
    concluida: false,
    criadaEm: new Date(),
    responsavel: null,
    acordoAtual: null,
  } as unknown as TaskWithAcordoAtualEResponsavel;
}

/** Builds a Task_Com_Acordo (has Acordo_Atual) fake row with the given id. */
function taskComAcordoFake(
  id: string,
  ordemExibicao: number,
  acordoId: string,
  estadoCumprimento: 'pendente' | 'cumprido' | 'nao_cumprido',
): TaskWithAcordoAtualEResponsavel {
  return {
    id,
    titulo: `Task ${id}`,
    descricao: null,
    responsavelId: null,
    numTentativas: 0,
    repeteAcordoNaoCumprido: false,
    ordemExibicao,
    acordoAtualId: acordoId,
    concluida: false,
    criadaEm: new Date(),
    responsavel: null,
    acordoAtual: {
      id: acordoId,
      taskId: id,
      tipoAcordoId: 'tipo-1',
      dataRegistro: new Date(),
      estadoCumprimento,
      motivoNaoCumprimentoId: null,
      tipoAcordo: { id: 'tipo-1', nome: 'Avaliar e planejar' },
    },
  } as unknown as TaskWithAcordoAtualEResponsavel;
}

/** One fake active Task, tagged with whether it should end up as Task_Com_Acordo. */
const taskSpecArb = fc.record({
  id: fc.uuid(),
  comAcordo: fc.boolean(),
  estadoCumprimento: fc.constantFrom<'pendente' | 'cumprido' | 'nao_cumprido'>(
    'pendente',
    'cumprido',
    'nao_cumprido',
  ),
});

/** Arrays of task specs with pairwise-distinct ids (no accidental id collisions). */
const taskSpecsArb = fc
  .array(taskSpecArb, { minLength: 0, maxLength: 30 })
  .map((specs) => {
    const seen = new Set<string>();
    return specs.filter((spec) => {
      if (seen.has(spec.id)) {
        return false;
      }
      seen.add(spec.id);
      return true;
    });
  });

/**
 * One fake active Task, tagged with the fields Property 11 checks:
 * título, optional Responsável nome, and — when `comAcordo` — the
 * Acordo_Atual's Tipo_de_Acordo nome and data de registro.
 */
const taskSpecComCamposArb = fc
  .array(
    fc.record({
      id: fc.uuid(),
      titulo: fc.string({ minLength: 1, maxLength: 200 }),
      responsavelNome: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
      comAcordo: fc.boolean(),
      tipoAcordoNome: fc.string({ minLength: 1, maxLength: 100 }),
      dataRegistro: fc.date(),
    }),
    { minLength: 0, maxLength: 30 },
  )
  .map((specs) => {
    const seen = new Set<string>();
    return specs.filter((spec) => {
      if (seen.has(spec.id)) {
        return false;
      }
      seen.add(spec.id);
      return true;
    });
  });

interface TaskSpecComCampos {
  id: string;
  titulo: string;
  responsavelNome: string | undefined;
  comAcordo: boolean;
  tipoAcordoNome: string;
  dataRegistro: Date;
}

/** Builds a Task_Nova fake row carrying the fields Property 11 checks. */
function taskNovaFakeComCampos(spec: TaskSpecComCampos, ordemExibicao: number): TaskWithAcordoAtualEResponsavel {
  return {
    id: spec.id,
    titulo: spec.titulo,
    descricao: null,
    responsavelId: spec.responsavelNome !== undefined ? `resp-${spec.id}` : null,
    numTentativas: 0,
    ordemExibicao,
    acordoAtualId: null,
    concluida: false,
    criadaEm: new Date(),
    responsavel: spec.responsavelNome !== undefined ? { id: `resp-${spec.id}`, nomeLogin: spec.responsavelNome } : null,
    acordoAtual: null,
  } as unknown as TaskWithAcordoAtualEResponsavel;
}

/** Builds a Task_Com_Acordo fake row carrying the fields Property 11 checks. */
function taskComAcordoFakeComCampos(spec: TaskSpecComCampos, ordemExibicao: number): TaskWithAcordoAtualEResponsavel {
  const acordoId = `acordo-${spec.id}`;
  return {
    id: spec.id,
    titulo: spec.titulo,
    descricao: null,
    responsavelId: spec.responsavelNome !== undefined ? `resp-${spec.id}` : null,
    numTentativas: 0,
    ordemExibicao,
    acordoAtualId: acordoId,
    concluida: false,
    criadaEm: new Date(),
    responsavel: spec.responsavelNome !== undefined ? { id: `resp-${spec.id}`, nomeLogin: spec.responsavelNome } : null,
    acordoAtual: {
      id: acordoId,
      taskId: spec.id,
      tipoAcordoId: 'tipo-1',
      dataRegistro: spec.dataRegistro,
      estadoCumprimento: 'pendente',
      motivoNaoCumprimentoId: null,
      tipoAcordo: { id: 'tipo-1', nome: spec.tipoAcordoNome },
    },
  } as unknown as TaskWithAcordoAtualEResponsavel;
}

describe('ListaDeAcordosService.obterLista', () => {
  // Property 10: Agrupamento exaustivo e mutuamente exclusivo
  // Validates: Requirements 3.2, 3.4, 8.1
  it('Feature: daily-agreements, Property 10: Agrupamento exaustivo e mutuamente exclusivo', async () => {
    await fc.assert(
      fc.asyncProperty(taskSpecsArb, async (specs) => {
        const tasks = specs.map((spec, index) =>
          spec.comAcordo
            ? taskComAcordoFake(spec.id, index, `acordo-${spec.id}`, spec.estadoCumprimento)
            : taskNovaFake(spec.id, index),
        );

        const repository = new InMemoryTaskRepositoryComLista(tasks);
        const service = new ListaDeAcordosService(repository as unknown as TaskRepository);

        const lista = await service.obterLista();

        // ambos os grupos estão sempre presentes na estrutura de saída,
        // mesmo quando vazios (Requirements 3.2, 3.4, 8.1).
        expect(lista.taskNova).toBeInstanceOf(Array);
        expect(lista.taskComAcordo).toBeInstanceOf(Array);

        const idsEsperadosNova = new Set(specs.filter((s) => !s.comAcordo).map((s) => s.id));
        const idsEsperadosComAcordo = new Set(specs.filter((s) => s.comAcordo).map((s) => s.id));

        const idsObtidosNova = lista.taskNova.map((t) => t.id);
        const idsObtidosComAcordo = lista.taskComAcordo.map((t) => t.id);

        // cada grupo contém exatamente as Tasks esperadas — sem ausência
        // (Requirement 3.2/3.4) e sem duplicação dentro do próprio grupo.
        expect(new Set(idsObtidosNova)).toEqual(idsEsperadosNova);
        expect(idsObtidosNova).toHaveLength(idsEsperadosNova.size);
        expect(new Set(idsObtidosComAcordo)).toEqual(idsEsperadosComAcordo);
        expect(idsObtidosComAcordo).toHaveLength(idsEsperadosComAcordo.size);

        // os grupos são mutuamente exclusivos: nenhuma Task aparece em
        // ambos (Requirement 8.1).
        const intersecao = idsObtidosNova.filter((id) => idsObtidosComAcordo.includes(id));
        expect(intersecao).toHaveLength(0);

        // a partição é exaustiva: a união dos dois grupos reproduz
        // exatamente o conjunto de Tasks de entrada, sem perda nem
        // duplicação entre os grupos (Requirement 3.2).
        const idsUniao = [...idsObtidosNova, ...idsObtidosComAcordo].sort();
        const idsEntrada = specs.map((s) => s.id).sort();
        expect(idsUniao).toEqual(idsEntrada);
      }),
      { numRuns: 100 },
    );
  });

  // Property 11: Campos exigidos por item da lista
  // Validates: Requirements 3.1, 3.3
  it('Feature: daily-agreements, Property 11: Campos exigidos por item da lista', async () => {
    await fc.assert(
      fc.asyncProperty(taskSpecComCamposArb, async (specs) => {
        const tasks = specs.map((spec, index) =>
          spec.comAcordo
            ? taskComAcordoFakeComCampos(spec, index)
            : taskNovaFakeComCampos(spec, index),
        );

        const repository = new InMemoryTaskRepositoryComLista(tasks);
        const service = new ListaDeAcordosService(repository as unknown as TaskRepository);

        const lista = await service.obterLista();

        for (const spec of specs) {
          const item = spec.comAcordo
            ? lista.taskComAcordo.find((t) => t.id === spec.id)
            : lista.taskNova.find((t) => t.id === spec.id);

          expect(item).toBeDefined();
          if (!item) continue;

          // título é sempre exigido, para ambos os grupos (Requirements 3.1, 3.3).
          expect(item.titulo).toBe(spec.titulo);

          // Responsável aparece quando definido, e fica ausente/undefined
          // quando não definido, em ambos os grupos (Requirements 3.1, 3.3).
          if (spec.responsavelNome !== undefined) {
            expect(item.responsavelNome).toBe(spec.responsavelNome);
          } else {
            expect(item.responsavelNome).toBeUndefined();
          }

          if (spec.comAcordo) {
            const itemComAcordo = item as TaskComAcordoItem;
            // Tipo_de_Acordo e data de registro do Acordo_Atual são
            // exigidos apenas para Task_Com_Acordo (Requirements 3.1).
            expect(itemComAcordo.tipoAcordoNome).toBe(spec.tipoAcordoNome);
            expect(itemComAcordo.dataRegistroAcordoAtual.getTime()).toBe(spec.dataRegistro.getTime());
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // Property 12: Ordenação por Ordem_de_Exibição
  // Validates: Requirements 3.5
  it('Feature: daily-agreements, Property 12: Ordenação por Ordem_de_Exibição', async () => {
    // Each spec gets a distinct `ordemExibicao` (its original index before
    // shuffling), then the array itself is shuffled so the order in which
    // the fake repository hands Tasks back is decoupled from both
    // `ordemExibicao` and id order — the only way `obterLista` can produce
    // a correctly ordered result is by actually sorting on `ordemExibicao`
    // (Requirement 3.5).
    const taskOrdemSpecsArb = fc
      .array(fc.record({ id: fc.uuid(), comAcordo: fc.boolean() }), { minLength: 0, maxLength: 30 })
      .map((specs) => {
        const seen = new Set<string>();
        return specs.filter((spec) => {
          if (seen.has(spec.id)) {
            return false;
          }
          seen.add(spec.id);
          return true;
        });
      })
      .map((specs) => specs.map((spec, index) => ({ ...spec, ordemExibicao: index })))
      .chain((specsComOrdem) =>
        fc.shuffledSubarray(specsComOrdem, { minLength: specsComOrdem.length, maxLength: specsComOrdem.length }),
      );

    await fc.assert(
      fc.asyncProperty(taskOrdemSpecsArb, async (specsEmbaralhados) => {
        const tasks = specsEmbaralhados.map((spec) =>
          spec.comAcordo
            ? taskComAcordoFake(spec.id, spec.ordemExibicao, `acordo-${spec.id}`, 'pendente')
            : taskNovaFake(spec.id, spec.ordemExibicao),
        );

        const repository = new InMemoryTaskRepositoryComLista(tasks);
        const service = new ListaDeAcordosService(repository as unknown as TaskRepository);

        const lista = await service.obterLista();

        const ordensNova = lista.taskNova.map((t) => t.ordemExibicao);
        const ordensComAcordo = lista.taskComAcordo.map((t) => t.ordemExibicao);

        // cada grupo apresenta as Tasks em ordem não-decrescente de
        // `ordemExibicao` (Requirement 3.5).
        for (let i = 1; i < ordensNova.length; i++) {
          expect(ordensNova[i]).toBeGreaterThanOrEqual(ordensNova[i - 1]);
        }
        for (let i = 1; i < ordensComAcordo.length; i++) {
          expect(ordensComAcordo[i]).toBeGreaterThanOrEqual(ordensComAcordo[i - 1]);
        }

        // além de não-decrescente, a ordem obtida reproduz exatamente os
        // valores de `ordemExibicao` esperados por grupo, em ordem
        // crescente — confirmando que a ordenação não depende da ordem de
        // entrada (que foi embaralhada).
        const ordensEsperadasNova = specsEmbaralhados
          .filter((s) => !s.comAcordo)
          .map((s) => s.ordemExibicao)
          .sort((a, b) => a - b);
        const ordensEsperadasComAcordo = specsEmbaralhados
          .filter((s) => s.comAcordo)
          .map((s) => s.ordemExibicao)
          .sort((a, b) => a - b);

        expect(ordensNova).toEqual(ordensEsperadasNova);
        expect(ordensComAcordo).toEqual(ordensEsperadasComAcordo);
      }),
      { numRuns: 100 },
    );
  });

  // Property 13: Indicador de alerta para Acordo não cumprido
  // Validates: Requirements 3.6
  it('Feature: daily-agreements, Property 13: Indicador de alerta para Acordo não cumprido', async () => {
    const taskComAcordoEstadoENumTentativasArb = fc
      .array(
        fc.record({
          id: fc.uuid(),
          estadoCumprimento: fc.constantFrom<'pendente' | 'cumprido' | 'nao_cumprido'>(
            'pendente',
            'cumprido',
            'nao_cumprido',
          ),
          numTentativas: fc.nat({ max: 50 }),
        }),
        { minLength: 0, maxLength: 30 },
      )
      .map((specs) => {
        const seen = new Set<string>();
        return specs.filter((spec) => {
          if (seen.has(spec.id)) {
            return false;
          }
          seen.add(spec.id);
          return true;
        });
      });

    await fc.assert(
      fc.asyncProperty(taskComAcordoEstadoENumTentativasArb, async (specs) => {
        const tasks = specs.map((spec, index) => {
          const task = taskComAcordoFake(spec.id, index, `acordo-${spec.id}`, spec.estadoCumprimento);
          return { ...task, numTentativas: spec.numTentativas };
        });

        const repository = new InMemoryTaskRepositoryComLista(tasks);
        const service = new ListaDeAcordosService(repository as unknown as TaskRepository);

        const lista = await service.obterLista();

        for (const spec of specs) {
          const item = lista.taskComAcordo.find((t) => t.id === spec.id);
          expect(item).toBeDefined();
          if (!item) continue;

          if (spec.estadoCumprimento === 'nao_cumprido') {
            // Acordo_Atual não cumprido: indicador de alerta ativo e
            // numTentativas corrente presentes no item (Requirement 3.6).
            expect(item.alerta).toBe(true);
            expect(item.numTentativas).toBe(spec.numTentativas);
          } else {
            // pendente ou cumprido: o indicador de alerta NÃO deve estar
            // ativo (inverso da Property 13, conforme a implementação da
            // tarefa 15.1).
            expect(item.alerta).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // Alerta de não cumprimento também deve permanecer ativo quando a Task
  // está marcada com `repeteAcordoNaoCumprido` (fluxo "Repetir último
  // acordo" para Tipo_de_Acordo diferente de "Avaliar e planejar"), ainda
  // que o Acordo_Atual já esteja `pendente` novamente — sem depender
  // apenas de `estadoCumprimento === 'nao_cumprido'`.
  it('mantém o alerta de não cumprimento ativo quando repeteAcordoNaoCumprido é true, mesmo com Acordo_Atual pendente', async () => {
    const task = taskComAcordoFake('task-repetido', 0, 'acordo-repetido', 'pendente');
    const tasks = [{ ...task, repeteAcordoNaoCumprido: true, numTentativas: 1 }];

    const repository = new InMemoryTaskRepositoryComLista(tasks);
    const service = new ListaDeAcordosService(repository as unknown as TaskRepository);

    const lista = await service.obterLista();

    const item = lista.taskComAcordo.find((t) => t.id === 'task-repetido');
    expect(item).toBeDefined();
    expect(item!.alerta).toBe(true);
    expect(item!.numTentativas).toBe(1);
  });

  it('não mantém o alerta quando repeteAcordoNaoCumprido é false e o Acordo_Atual está pendente/cumprido', async () => {
    const task = taskComAcordoFake('task-normal', 0, 'acordo-normal', 'cumprido');
    const tasks = [{ ...task, repeteAcordoNaoCumprido: false }];

    const repository = new InMemoryTaskRepositoryComLista(tasks);
    const service = new ListaDeAcordosService(repository as unknown as TaskRepository);

    const lista = await service.obterLista();

    const item = lista.taskComAcordo.find((t) => t.id === 'task-normal');
    expect(item).toBeDefined();
    expect(item!.alerta).toBe(false);
  });

  // Alerta de alto número de tentativas de "Avaliar e planejar"
  // (tentativasAvaliarPlanejar >= 3): distinto do alerta de não cumprido,
  // ativo independentemente do estadoCumprimento do Acordo_Atual, e
  // sempre acompanhado do contador corrente.
  it('sinaliza alertaTentativasAvaliarPlanejar quando tentativasAvaliarPlanejar atinge o limite, independentemente do estadoCumprimento', async () => {
    const casos: Array<{ tentativas: number; estado: 'pendente' | 'cumprido' | 'nao_cumprido' }> = [
      { tentativas: 0, estado: 'cumprido' },
      { tentativas: 1, estado: 'cumprido' },
      { tentativas: 2, estado: 'pendente' },
      { tentativas: 3, estado: 'cumprido' },
      { tentativas: 4, estado: 'pendente' },
      { tentativas: 5, estado: 'nao_cumprido' },
    ];

    const tasks = casos.map((caso, index) => {
      const task = taskComAcordoFake(`task-${index}`, index, `acordo-${index}`, caso.estado);
      return { ...task, tentativasAvaliarPlanejar: caso.tentativas };
    });

    const repository = new InMemoryTaskRepositoryComLista(tasks);
    const service = new ListaDeAcordosService(repository as unknown as TaskRepository);

    const lista = await service.obterLista();

    for (let i = 0; i < casos.length; i += 1) {
      const item = lista.taskComAcordo.find((t) => t.id === `task-${i}`);
      expect(item).toBeDefined();
      if (!item) continue;

      expect(item.tentativasAvaliarPlanejar).toBe(casos[i]!.tentativas);
      expect(item.alertaTentativasAvaliarPlanejar).toBe(casos[i]!.tentativas >= 3);
    }
  });

  // Property: alerta de tentativas de Avaliar e planejar não depende do
  // estadoCumprimento — só depende de tentativasAvaliarPlanejar >= 3.
  it('Feature: daily-agreements, Property: alerta de tentativas de Avaliar e planejar reflete o limite de 3', async () => {
    const taskComTentativasArb = fc
      .array(
        fc.record({
          id: fc.uuid(),
          estadoCumprimento: fc.constantFrom<'pendente' | 'cumprido' | 'nao_cumprido'>(
            'pendente',
            'cumprido',
            'nao_cumprido',
          ),
          tentativasAvaliarPlanejar: fc.nat({ max: 10 }),
        }),
        { minLength: 0, maxLength: 30 },
      )
      .map((specs) => {
        const seen = new Set<string>();
        return specs.filter((spec) => {
          if (seen.has(spec.id)) return false;
          seen.add(spec.id);
          return true;
        });
      });

    await fc.assert(
      fc.asyncProperty(taskComTentativasArb, async (specs) => {
        const tasks = specs.map((spec, index) => {
          const task = taskComAcordoFake(spec.id, index, `acordo-${spec.id}`, spec.estadoCumprimento);
          return { ...task, tentativasAvaliarPlanejar: spec.tentativasAvaliarPlanejar };
        });

        const repository = new InMemoryTaskRepositoryComLista(tasks);
        const service = new ListaDeAcordosService(repository as unknown as TaskRepository);

        const lista = await service.obterLista();

        for (const spec of specs) {
          const item = lista.taskComAcordo.find((t) => t.id === spec.id);
          expect(item).toBeDefined();
          if (!item) continue;

          expect(item.tentativasAvaliarPlanejar).toBe(spec.tentativasAvaliarPlanejar);
          expect(item.alertaTentativasAvaliarPlanejar).toBe(spec.tentativasAvaliarPlanejar >= 3);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Property 30: Filtro por título ou Responsável
  // Validates: Requirements 13.1, 13.2, 13.3
  it('Feature: daily-agreements, Property 30: Filtro por título ou Responsável', async () => {
    // Reuses `taskSpecComCamposArb` (título/Responsável/comAcordo specs
    // from Property 11) and derives the search term from that same data:
    // either an exact substring of some spec's título/Responsável (so
    // matches actually occur across runs) or unrelated random noise (so
    // the empty-result case is also exercised), each optionally
    // re-cased, to stress the case-insensitive comparison from both
    // sides (Requirements 13.1, 13.2).
    const casoFiltroArb = taskSpecComCamposArb.chain((specs) => {
      const candidatos = specs.flatMap((spec) =>
        spec.responsavelNome !== undefined ? [spec.titulo, spec.responsavelNome] : [spec.titulo],
      );

      const substringDeArb = (fonte: string): fc.Arbitrary<string> => {
        if (fonte.length === 0) {
          return fc.constant('');
        }
        return fc
          .tuple(fc.nat({ max: fonte.length - 1 }), fc.nat({ max: fonte.length - 1 }))
          .map(([a, b]) => fonte.slice(Math.min(a, b), Math.max(a, b) + 1));
      };

      const termoBaseArb =
        candidatos.length > 0
          ? fc.oneof(
              fc.constantFrom(...candidatos).chain(substringDeArb),
              fc.string({ minLength: 0, maxLength: 8 }),
            )
          : fc.string({ minLength: 0, maxLength: 8 });

      const termoArb = fc
        .tuple(termoBaseArb, fc.constantFrom<'original' | 'upper' | 'lower'>('original', 'upper', 'lower'))
        .map(([termo, modo]) => (modo === 'upper' ? termo.toUpperCase() : modo === 'lower' ? termo.toLowerCase() : termo));

      return fc.tuple(fc.constant(specs), termoArb);
    });

    await fc.assert(
      fc.asyncProperty(casoFiltroArb, async ([specs, termo]) => {
        const tasks = specs.map((spec, index) =>
          spec.comAcordo ? taskComAcordoFakeComCampos(spec, index) : taskNovaFakeComCampos(spec, index),
        );

        const repository = new InMemoryTaskRepositoryComLista(tasks);
        const service = new ListaDeAcordosService(repository as unknown as TaskRepository);

        const lista = await service.obterLista(termo);

        // mesma normalização usada pela implementação (task 15.6): termo
        // vazio após trim restaura a lista completa (Requirement 13.4,
        // testada separadamente pela Property 31); aqui só precisamos
        // computar o conjunto esperado de forma consistente.
        const termoNormalizado = termo.trim().toLowerCase();
        const idsEsperados = specs
          .filter((spec) => {
            if (termoNormalizado === '') {
              return true;
            }
            const tituloContem = spec.titulo.toLowerCase().includes(termoNormalizado);
            const responsavelContem = spec.responsavelNome?.toLowerCase().includes(termoNormalizado) ?? false;
            return tituloContem || responsavelContem;
          })
          .map((spec) => spec.id);

        const idsObtidos = [...lista.taskNova.map((t) => t.id), ...lista.taskComAcordo.map((t) => t.id)];

        // a Lista_de_Acordos filtrada contém exatamente as Tasks
        // esperadas — nem mais, nem menos — incluindo o caso em que esse
        // conjunto é vazio (Requirements 13.1, 13.2, 13.3).
        expect(new Set(idsObtidos)).toEqual(new Set(idsEsperados));
        expect(idsObtidos).toHaveLength(idsEsperados.length);

        if (idsEsperados.length === 0) {
          expect(lista.taskNova).toHaveLength(0);
          expect(lista.taskComAcordo).toHaveLength(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Property 31: Limpar busca restaura a lista completa
  // Validates: Requirements 13.4
  it('Feature: daily-agreements, Property 31: Limpar busca restaura a lista completa', async () => {
    // A "cleared search" is exercised as an empty string and as
    // whitespace-only strings (both of which must trim to empty per the
    // implementation of task 15.6), compared against calling
    // `obterLista` with no argument at all — for the same underlying
    // active Task set, all three must produce identical grouping and
    // ordering (Requirement 13.4).
    const termoVazioArb = fc.oneof(
      fc.constant(''),
      fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 5 }),
    );

    await fc.assert(
      fc.asyncProperty(taskSpecComCamposArb, termoVazioArb, async (specs, termoVazio) => {
        const tasks = specs.map((spec, index) =>
          spec.comAcordo ? taskComAcordoFakeComCampos(spec, index) : taskNovaFakeComCampos(spec, index),
        );

        const repository = new InMemoryTaskRepositoryComLista(tasks);
        const service = new ListaDeAcordosService(repository as unknown as TaskRepository);

        const listaSemArgumento = await service.obterLista();
        const listaComTermoVazio = await service.obterLista(termoVazio);

        // ambas as chamadas produzem exatamente o mesmo agrupamento e a
        // mesma ordenação da lista completa de Tasks ativas — limpar a
        // busca (string vazia ou somente espaços) equivale a não passar
        // nenhum termo (Requirement 13.4).
        expect(listaComTermoVazio.taskNova.map((t) => t.id)).toEqual(listaSemArgumento.taskNova.map((t) => t.id));
        expect(listaComTermoVazio.taskComAcordo.map((t) => t.id)).toEqual(
          listaSemArgumento.taskComAcordo.map((t) => t.id),
        );
        expect(listaComTermoVazio).toEqual(listaSemArgumento);
      }),
      { numRuns: 100 },
    );
  });
});
