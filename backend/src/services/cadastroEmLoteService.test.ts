// Property-based test for CadastroEmLoteService.processarLote (task 17.2).
//
// Exercises the domain/service layer against in-memory fakes of
// TaskService.criarTask, AcordoService.registrarAcordo and the
// Tipo_de_Acordo lookup (per design.md "Testing Strategy": "Os testes de
// propriedade operam sobre a camada de domínio/serviços com persistência
// em memória ou mockada"), using CadastroEmLoteService's constructor
// injection instead of the real Prisma-backed singletons.
//
// This test focuses on lines WITHOUT a ";" separator (Requirement 12.3),
// i.e. pure título parsing, ordering and per-line error isolation
// (Requirements 12.1, 12.3, 12.4, 12.5, 12.8). Tipo_de_Acordo-specific
// parsing (lines with ";") is covered separately by Property 29 (task
// 17.3), so the generated lines never contain ";".

import { randomUUID } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CadastroRepository } from '../repositories/cadastroRepository.js';
import type { AcordoService } from './acordoService.js';
import { CadastroEmLoteService } from './cadastroEmLoteService.js';
import { ValidationError } from './errors.js';
import type { TaskService } from './taskService.js';

/**
 * In-memory fake of TaskService, exposing only `criarTask`, mirroring the
 * real título validation (trim, 1-200 chars — same limits as Requisito
 * 1, Requirement 12.4) and `ordemExibicao` assignment (sequentially at
 * the end of the list, in call order) without touching Prisma/SQLite.
 */
class FakeTaskService implements Pick<TaskService, 'criarTask'> {
  readonly criadas: { id: string; titulo: string; ordemExibicao: number }[] = [];
  private proximaOrdem = 0;

  async criarTask(input: { titulo: string }): ReturnType<TaskService['criarTask']> {
    const titulo = input.titulo.trim();
    if (titulo.length < 1 || titulo.length > 200) {
      throw new ValidationError(
        'TITULO_INVALIDO',
        'O título é obrigatório e deve ter no máximo 200 caracteres.',
      );
    }

    const task = {
      id: randomUUID(),
      titulo,
      ordemExibicao: this.proximaOrdem,
    };
    this.proximaOrdem += 1;
    this.criadas.push(task);

    return task as unknown as Awaited<ReturnType<TaskService['criarTask']>>;
  }
}

/**
 * In-memory fake of AcordoService, exposing only `registrarAcordo`. Not
 * expected to be called by any line in this property (no line contains
 * ";"), so any call is recorded and would surface as an unexpected extra
 * Task/Acordo pairing if the parsing logic regressed.
 */
class FakeAcordoService implements Pick<AcordoService, 'registrarAcordo'> {
  readonly chamadas: string[] = [];

  async registrarAcordo(taskId: string): ReturnType<AcordoService['registrarAcordo']> {
    this.chamadas.push(taskId);
    return {} as unknown as Awaited<ReturnType<AcordoService['registrarAcordo']>>;
  }
}

/** In-memory fake of the Tipo_de_Acordo lookup: never resolves anything (no line uses ";"). */
class FakeTipoAcordoRepository
  implements Pick<CadastroRepository<{ id: string; nome?: string }, unknown>, 'findByNomeCaseInsensitive'>
{
  async findByNomeCaseInsensitive(): Promise<{ id: string; nome?: string } | null> {
    return null;
  }
}

/** A single character that can never introduce a line break or a Tipo_de_Acordo separator. */
const charSemQuebraArb = fc.char().filter((c) => c !== '\n' && c !== '\r' && c !== ';');

/** Any string, free of "\n"/"\r"/";", whose trim() has between 1 and 200 characters. */
const tituloValidoArb = fc
  .stringOf(charSemQuebraArb, { minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length >= 1);

/** Any whitespace-only (space/tab) string: trim() results in an empty string. */
const tituloVazioAposTrimArb = fc.stringOf(fc.constantFrom(' ', '\t'), { maxLength: 20 });

/**
 * Any string, free of "\n"/"\r"/";", built from non-whitespace characters
 * only (so trim() never shrinks its length), whose length exceeds 200.
 */
const tituloExcedeLimiteArb = fc
  .array(charSemQuebraArb.filter((c) => c.trim().length > 0), { minLength: 201, maxLength: 250 })
  .map((chars) => chars.join(''));

/** A line spec tagged with whether it is expected to be accepted. */
const linhaSpecArb = fc.oneof(
  tituloValidoArb.map((texto) => ({ valida: true as const, texto })),
  fc.oneof(tituloVazioAposTrimArb, tituloExcedeLimiteArb).map((texto) => ({ valida: false as const, texto })),
);

/** A batch of one or more lines, none of which contains ";". */
const linhasArb = fc.array(linhaSpecArb, { minLength: 1, maxLength: 30 });

/**
 * In-memory fake of AcordoService, exposing only `registrarAcordo`, used
 * by Property 29 to record every call's `(taskId, tipoAcordoId)` pair in
 * call order — call order matches the order in which
 * `CadastroEmLoteService` processes lines sequentially, since lines are
 * awaited one at a time (see cadastroEmLoteService.ts's comment on
 * Requirement 12.8).
 */
class FakeAcordoServiceComRegistro implements Pick<AcordoService, 'registrarAcordo'> {
  readonly chamadas: { taskId: string; tipoAcordoId: string }[] = [];

  async registrarAcordo(
    taskId: string,
    tipoAcordoId: string,
  ): ReturnType<AcordoService['registrarAcordo']> {
    this.chamadas.push({ taskId, tipoAcordoId });
    return {} as unknown as Awaited<ReturnType<AcordoService['registrarAcordo']>>;
  }
}

/**
 * In-memory fake of the Tipo_de_Acordo lookup, backed by a fixed
 * "cadastro" of Tipos (Requirement 12.2), resolving names
 * case-insensitively against it — mirroring
 * `CadastroRepository.findByNomeCaseInsensitive` (see
 * cadastroRepository.ts) without touching Prisma/SQLite.
 */
class FakeTipoAcordoRepositoryComCadastro
  implements
    Pick<CadastroRepository<{ id: string; nome?: string }, unknown>, 'findByNomeCaseInsensitive'>
{
  constructor(private readonly cadastro: { id: string; nome: string }[]) {}

  async findByNomeCaseInsensitive(nome: string): Promise<{ id: string; nome?: string } | null> {
    const target = nome.toLowerCase();
    return this.cadastro.find((tipo) => tipo.nome.toLowerCase() === target) ?? null;
  }
}

/** Fixed Cadastro_de_Tipos_de_Acordo used by Property 29 (mirrors the seeded values). */
const cadastroTiposDeAcordo: { id: string; nome: string }[] = [
  'Avaliar e planejar',
  'Enviar para code review',
  'Enviar para review',
  'Enviar para deploy',
  'Finalizar',
].map((nome) => ({ id: randomUUID(), nome }));

const nomesCadastradosLowerCase = new Set(cadastroTiposDeAcordo.map((tipo) => tipo.nome.toLowerCase()));

/** Re-cases every character of `texto` independently (upper or lower), preserving non-letters as-is. */
const comCasingAleatorioArb = (texto: string): fc.Arbitrary<string> =>
  fc.array(fc.boolean(), { minLength: texto.length, maxLength: texto.length }).map((maiuscula) =>
    texto
      .split('')
      .map((char, index) => (maiuscula[index] ? char.toUpperCase() : char.toLowerCase()))
      .join(''),
  );

/** Optional leading/trailing whitespace, trimmed away before the Tipo_de_Acordo lookup. */
const espacosOpcionaisArb = fc.stringOf(fc.constantFrom(' ', '\t'), { maxLength: 5 });

/**
 * The text following ";" for a line whose Tipo_de_Acordo *does* belong
 * to the Cadastro_de_Tipos_de_Acordo: a case-randomized rendering of one
 * of the registered names (Requirement 12.2 resolves it
 * case-insensitively), optionally padded with whitespace that trim()
 * removes.
 */
const tipoAcordoCorrespondenteArb = fc
  .constantFrom(...cadastroTiposDeAcordo)
  .chain((tipoEsperado) =>
    fc
      .tuple(comCasingAleatorioArb(tipoEsperado.nome), espacosOpcionaisArb, espacosOpcionaisArb)
      .map(([nomeComCasing, prefixo, sufixo]) => ({
        tipoEsperado,
        tipoAcordoTexto: `${prefixo}${nomeComCasing}${sufixo}`,
      })),
  );

/**
 * The text following ";" for a line whose Tipo_de_Acordo does *not*
 * belong to the Cadastro_de_Tipos_de_Acordo (Requirement 12.6): any
 * string (free of line breaks/";") whose trimmed, lower-cased form never
 * matches a registered name.
 */
const tipoAcordoNaoCorrespondenteArb = fc
  .stringOf(charSemQuebraArb, { maxLength: 50 })
  .filter((texto) => !nomesCadastradosLowerCase.has(texto.trim().toLowerCase()));

/** A line spec (título + Tipo_de_Acordo text after ";") tagged with the expected resolution. */
const linhaComTipoSpecArb = fc.oneof(
  fc.tuple(tituloValidoArb, tipoAcordoCorrespondenteArb).map(([titulo, info]) => ({
    titulo,
    tipoAcordoTexto: info.tipoAcordoTexto,
    tipoEsperado: info.tipoEsperado,
  })),
  fc.tuple(tituloValidoArb, tipoAcordoNaoCorrespondenteArb).map(([titulo, tipoAcordoTexto]) => ({
    titulo,
    tipoAcordoTexto,
    tipoEsperado: null as { id: string; nome: string } | null,
  })),
);

/** A batch of one or more lines, all containing ";" (título;Tipo_de_Acordo). */
const linhasComTipoArb = fc.array(linhaComTipoSpecArb, { minLength: 1, maxLength: 20 });

describe('CadastroEmLoteService.processarLote', () => {
  // Property 28: Parsing e isolamento de erros no cadastro em lote
  // Validates: Requirements 12.1, 12.3, 12.4, 12.5, 12.8
  it('Feature: daily-agreements, Property 28: Parsing e isolamento de erros no cadastro em lote', async () => {
    await fc.assert(
      fc.asyncProperty(linhasArb, async (specs) => {
        const taskService = new FakeTaskService();
        const acordoService = new FakeAcordoService();
        const tipoAcordoRepository = new FakeTipoAcordoRepository();

        const service = new CadastroEmLoteService(
          taskService as unknown as TaskService,
          acordoService as unknown as AcordoService,
          tipoAcordoRepository,
        );

        const linhas = specs.map((spec) => spec.texto);
        const texto = linhas.join('\n');

        const resultados = await service.processarLote(texto);

        // (a) todas as N linhas aparecem no relatório, na mesma ordem em
        // que aparecem no texto original (Requirement 12.1).
        expect(resultados).toHaveLength(specs.length);
        resultados.forEach((resultado, index) => {
          expect(resultado.numeroLinha).toBe(index + 1);
          expect(resultado.linha).toBe(linhas[index]);
        });

        // (b) cada linha é aceita ou rejeitada de forma independente, de
        // acordo com a validação de título (mesmos limites do Requisito
        // 1 — Requirement 12.4), sem que uma linha inválida impeça o
        // cadastro das demais linhas válidas do mesmo lote (Requirements
        // 12.3, 12.5).
        resultados.forEach((resultado, index) => {
          const spec = specs[index]!;
          expect(resultado.aceita).toBe(spec.valida);

          if (spec.valida) {
            expect(resultado.taskId).toBeTruthy();
            expect(resultado.motivoCodigo).toBeUndefined();
          } else {
            expect(resultado.taskId).toBeUndefined();
            expect(resultado.motivoCodigo).toBe('TITULO_INVALIDO');
            expect(resultado.motivoMensagem).toBeTruthy();
          }
        });

        // nenhuma linha sem ";" resulta em chamada a registrarAcordo — a
        // Task correspondente é criada sem nenhum Acordo, classificada
        // como Task_Nova (Requirement 12.3).
        expect(acordoService.chamadas).toHaveLength(0);

        // exatamente uma Task é criada por linha válida — nem mais, nem
        // menos (Requirement 12.4).
        const quantidadeEsperadaDeAceitas = specs.filter((s) => s.valida).length;
        expect(taskService.criadas).toHaveLength(quantidadeEsperadaDeAceitas);

        // (c) as Tasks criadas a partir das linhas válidas recebem
        // ordemExibicao consistente com a ordem relativa dessas linhas no
        // texto original: estritamente crescente, na mesma ordem em que
        // as linhas válidas aparecem (Requirement 12.8).
        const idsAceitosNaOrdem = resultados
          .filter((resultado) => resultado.aceita)
          .map((resultado) => resultado.taskId!);

        const ordensNaOrdemDeAceitacao = idsAceitosNaOrdem.map(
          (taskId) => taskService.criadas.find((task) => task.id === taskId)!.ordemExibicao,
        );

        for (let i = 1; i < ordensNaOrdemDeAceitacao.length; i += 1) {
          expect(ordensNaOrdemDeAceitacao[i]).toBeGreaterThan(ordensNaOrdemDeAceitacao[i - 1]!);
        }

        // a sequência de ordemExibicao obtida é exatamente 0..k-1, na
        // ordem das linhas válidas do texto original.
        expect(ordensNaOrdemDeAceitacao).toEqual(
          Array.from({ length: quantidadeEsperadaDeAceitas }, (_, i) => i),
        );

        // os títulos armazenados correspondem ao resultado do trim de
        // cada linha válida, na mesma ordem relativa (Requirements 12.1,
        // 12.3, 12.4).
        const titulosEsperados = specs.filter((s) => s.valida).map((s) => s.texto.trim());
        const titulosObtidos = idsAceitosNaOrdem.map(
          (taskId) => taskService.criadas.find((task) => task.id === taskId)!.titulo,
        );
        expect(titulosObtidos).toEqual(titulosEsperados);
      }),
      { numRuns: 100 },
    );
  });

  // Property 29: Tratamento do Tipo_de_Acordo por linha do lote
  // Validates: Requirements 12.2, 12.6, 12.7
  it('Feature: daily-agreements, Property 29: Tratamento do Tipo_de_Acordo por linha do lote', async () => {
    await fc.assert(
      fc.asyncProperty(linhasComTipoArb, async (specs) => {
        const taskService = new FakeTaskService();
        const acordoService = new FakeAcordoServiceComRegistro();
        const tipoAcordoRepository = new FakeTipoAcordoRepositoryComCadastro(cadastroTiposDeAcordo);

        const service = new CadastroEmLoteService(
          taskService as unknown as TaskService,
          acordoService as unknown as AcordoService,
          tipoAcordoRepository,
        );

        const linhas = specs.map((spec) => `${spec.titulo};${spec.tipoAcordoTexto}`);
        const texto = linhas.join('\n');

        const resultados = await service.processarLote(texto);

        expect(resultados).toHaveLength(specs.length);

        resultados.forEach((resultado, index) => {
          const spec = specs[index]!;

          if (spec.tipoEsperado) {
            // Tipo_de_Acordo pertence ao Cadastro_de_Tipos_de_Acordo: a
            // linha é aceita, a Task criada recebe um Acordo desse tipo
            // como Acordo_Atual, e é classificada como Task_Com_Acordo
            // (Requirements 12.2, 12.7).
            expect(resultado.aceita).toBe(true);
            expect(resultado.taskId).toBeTruthy();
            expect(resultado.motivoCodigo).toBeUndefined();

            const chamada = acordoService.chamadas.find((c) => c.taskId === resultado.taskId);
            expect(chamada).toBeDefined();
            expect(chamada!.tipoAcordoId).toBe(spec.tipoEsperado.id);
          } else {
            // Tipo_de_Acordo não pertence ao Cadastro_de_Tipos_de_Acordo:
            // apenas esta linha é rejeitada, com motivo, sem impedir o
            // cadastro das demais linhas válidas do lote (Requirement
            // 12.6).
            expect(resultado.aceita).toBe(false);
            expect(resultado.taskId).toBeUndefined();
            expect(resultado.motivoCodigo).toBe('TIPO_ACORDO_INVALIDO');
            expect(resultado.motivoMensagem).toBeTruthy();
          }
        });

        // registrarAcordo é chamado exatamente uma vez por linha cujo
        // Tipo_de_Acordo pertence ao cadastro, nem mais nem menos
        // (Requirements 12.2, 12.6, 12.7).
        const quantidadeEsperadaDeCorrespondentes = specs.filter((s) => s.tipoEsperado).length;
        expect(acordoService.chamadas).toHaveLength(quantidadeEsperadaDeCorrespondentes);

        // as demais linhas válidas (com ou sem Tipo_de_Acordo
        // correspondente) continuam sendo processadas: o total de Tasks
        // criadas é igual ao número de linhas com Tipo_de_Acordo
        // correspondente (todas têm título válido, por construção do
        // gerador) — nenhuma linha rejeitada por Tipo_de_Acordo inválido
        // impede o cadastro das demais (Requirement 12.6).
        expect(taskService.criadas).toHaveLength(quantidadeEsperadaDeCorrespondentes);
      }),
      { numRuns: 100 },
    );
  });
});
