// Property-based tests for CadastroService (task 5.2).
//
// These tests exercise the generic domain/service layer against an
// in-memory fake of CadastroRepository, keeping the property runs fast
// and deterministic (per design.md "Testing Strategy": "Os testes de
// propriedade operam sobre a camada de domínio/serviços com persistência
// em memória ou mockada").
//
// CadastroService is reused, unmodified, by the three configurable
// cadastros (Cadastro_de_Tipos_de_Acordo, Cadastro_de_Motivos_de_Nao_Cumprimento,
// Cadastro_de_Usuários — Requirements 10.2, 10.3, 11.2, 11.3, 15.2, 15.3,
// 15.4, 15.5), so exercising the generic class directly with a
// parameterized `maxLength` covers all three.

import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { CadastroService } from './cadastroService.js';

/** Row shape used by the fake — mirrors the minimal Prisma model shape. */
interface FakeRow extends Record<string, unknown> {
  id: string;
  nome: string;
}

/**
 * In-memory fake of CadastroRepository, exposing the same public surface
 * (list/add/existsByNameCaseInsensitive) used by CadastroService, without
 * touching Prisma/SQLite.
 */
class InMemoryCadastroRepository {
  private readonly rows: FakeRow[] = [];

  async list(): Promise<FakeRow[]> {
    return [...this.rows];
  }

  /**
   * Directly seeds the fake with pre-existing rows, bypassing the service
   * — models the "estado semeado inicial" (seeded initial state) produced
   * by the seed script (Requirements 10.1, 11.1, 15.1), without going
   * through `adicionar`'s validation.
   */
  seed(nomes: string[]): void {
    for (const nome of nomes) {
      this.rows.push({ id: randomUUID(), nome });
    }
  }

  async add(data: { nome: string }): Promise<FakeRow> {
    const row: FakeRow = { id: randomUUID(), nome: data.nome };
    this.rows.push(row);
    return row;
  }

  async existsByNameCaseInsensitive(nome: string): Promise<boolean> {
    const target = nome.toLowerCase();
    return this.rows.some((row) => row.nome.toLowerCase() === target);
  }

  async findById(id: string): Promise<FakeRow | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async remove(id: string): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) this.rows.splice(index, 1);
  }
}

const MAX_LENGTH = 100;

function buildService(repository: InMemoryCadastroRepository) {
  return new CadastroService(repository, {
    label: 'Valor',
    buildCreateInput: (valor: string) => ({ nome: valor }),
    maxLength: MAX_LENGTH,
  });
}

/** Any string whose trim() has between 1 and MAX_LENGTH characters. */
const valorValidoArb = fc
  .string({ minLength: 1, maxLength: MAX_LENGTH })
  .filter((s) => s.trim().length >= 1 && s.trim().length <= MAX_LENGTH);

/** Any string whose trim() results in an empty string. */
const valorVazioAposTrimArb = fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), {
  maxLength: 20,
});

/**
 * Any string whose trim() exceeds MAX_LENGTH characters. Built from
 * non-whitespace characters only, so trim() never shrinks the length
 * below the generated size.
 */
const valorExcedeLimiteArb = fc
  .array(
    fc.char().filter((c) => c.trim().length > 0),
    { minLength: MAX_LENGTH + 1, maxLength: MAX_LENGTH + 50 },
  )
  .map((chars) => chars.join(''));

/** Any valor that `adicionar` must reject: trim empty or trim > MAX_LENGTH chars. */
const valorInvalidoArb = fc.oneof(valorVazioAposTrimArb, valorExcedeLimiteArb);

describe('CadastroService.adicionar', () => {
  // Property 25: Inclusão em cadastro configurável
  // Validates: Requirements 10.2, 10.3, 11.2, 11.3, 15.2, 15.3, 15.4, 15.5
  it('Feature: daily-agreements, Property 25: Inclusão em cadastro configurável', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(valorValidoArb, { minLength: 0, maxLength: 10 }),
        fc.oneof(
          valorValidoArb,
          valorInvalidoArb,
          // duplicado case-insensitive de um valor já existente, quando houver algum
          fc.constant(null),
        ),
        fc.nat(),
        fc.string({ minLength: 0, maxLength: 5 }), // casing noise for duplicate variant
        async (valoresExistentes, candidato, pickIndex, casingSeed) => {
          const repository = new InMemoryCadastroRepository();
          const service = buildService(repository);

          // popula o cadastro com valores válidos existentes antes da tentativa,
          // deduplicando case-insensitively: `valoresExistentes` é gerado sem
          // garantia de unicidade, e um valor duplicado seria corretamente
          // rejeitado por `adicionar` (Property 25 em si), o que não deve ser
          // confundido com uma falha da propriedade sob teste.
          const valoresExistentesUnicos: string[] = [];
          for (const valor of valoresExistentes) {
            const trimmed = valor.trim();
            const jaExiste = valoresExistentesUnicos.some(
              (v) => v.toLowerCase() === trimmed.toLowerCase(),
            );
            if (!jaExiste) valoresExistentesUnicos.push(valor);
          }
          for (const valor of valoresExistentesUnicos) {
            await service.adicionar(valor);
          }

          const antes = await repository.list();

          // Deriva o valor efetivamente submetido: quando `candidato` é null e
          // há valores existentes, submete uma variação de caixa (case) de um
          // valor já cadastrado, para exercer a rejeição por duplicidade
          // case-insensitive (Requirements 10.3, 11.3, 15.3, 15.5).
          let valorSubmetido: string;
          let esperaDuplicado = false;
          if (candidato === null) {
            if (antes.length === 0) {
              valorSubmetido = 'valor-base';
            } else {
              const existente = antes[pickIndex % antes.length];
              valorSubmetido = casingSeed.length % 2 === 0
                ? existente.nome.toUpperCase()
                : existente.nome.toLowerCase();
              esperaDuplicado = true;
            }
          } else {
            valorSubmetido = candidato;
          }

          const trimmed = valorSubmetido.trim();
          const vazio = trimmed.length < 1;
          const excedeLimite = trimmed.length > MAX_LENGTH;
          const duplicado =
            esperaDuplicado ||
            (!vazio &&
              !excedeLimite &&
              antes.some((row) => row.nome.toLowerCase() === trimmed.toLowerCase()));

          if (!vazio && !excedeLimite && !duplicado) {
            // Inclusão válida (Requirements 10.2, 11.2, 15.2): o valor deve
            // ser adicionado ao cadastro.
            const criado = await service.adicionar(valorSubmetido);
            expect(criado.nome).toBe(trimmed);

            const depois = await repository.list();
            expect(depois.length).toBe(antes.length + 1);
            expect(depois.some((row) => row.id === criado.id && row.nome === trimmed)).toBe(true);
          } else {
            // Inclusão rejeitada (vazio, acima do limite, ou duplicado
            // case-insensitive — Requirements 10.3, 11.3, 15.3, 15.4, 15.5):
            // o cadastro deve permanecer inalterado.
            const ExpectedError = duplicado && !vazio && !excedeLimite ? ConflictError : ValidationError;

            await expect(service.adicionar(valorSubmetido)).rejects.toThrow(ExpectedError);

            const depois = await repository.list();
            expect(depois).toEqual(antes);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('CadastroService.listar', () => {
  // Property 26: Consulta de cadastro retorna semente ∪ adicionados
  // Validates: Requirements 10.4, 11.4, 15.6
  it('Feature: daily-agreements, Property 26: Consulta de cadastro retorna semente ∪ adicionados', async () => {
    await fc.assert(
      fc.asyncProperty(
        // seed values pre-populating the repository, modeling the
        // "estado semeado inicial" (e.g. os cinco Tipos_de_Acordo,
        // os cinco Motivos_de_Nao_Cumprimento, ou o Usuário seed)
        fc.array(valorValidoArb, { minLength: 0, maxLength: 6 }),
        // values validly added afterwards, via adicionar()
        fc.array(valorValidoArb, { minLength: 0, maxLength: 10 }),
        async (sementes, adicoes) => {
          const repository = new InMemoryCadastroRepository();

          // Deduplicate seeds case-insensitively (the seed script never
          // seeds duplicates), so every seed value stays addressable.
          const sementesUnicas: string[] = [];
          for (const semente of sementes) {
            const trimmed = semente.trim();
            const jaExiste = sementesUnicas.some(
              (s) => s.toLowerCase() === trimmed.toLowerCase(),
            );
            if (!jaExiste) sementesUnicas.push(trimmed);
          }
          repository.seed(sementesUnicas);

          const service = buildService(repository);

          // Applies the sequence of additions, skipping any that would be
          // rejected (duplicate of seed/prior addition, case-insensitive)
          // so only *validly added* values are tracked, matching the
          // "sequência de inclusões válidas" wording of the property.
          const adicionadosComSucesso: string[] = [];
          for (const valor of adicoes) {
            try {
              const criado = await service.adicionar(valor);
              adicionadosComSucesso.push(criado.nome);
            } catch {
              // rejected addition (duplicate) — not part of the expected set
            }
          }

          const resultado = await service.listar();
          const nomesResultado = resultado.map((row) => row.nome);

          const esperado = [...sementesUnicas, ...adicionadosComSucesso];

          // No loss nor duplication: same multiset of names, regardless of order.
          expect(nomesResultado.length).toBe(esperado.length);
          expect([...nomesResultado].sort()).toEqual([...esperado].sort());

          // Every seed value is still present.
          for (const semente of sementesUnicas) {
            expect(nomesResultado).toContain(semente);
          }
          // Every validly-added value is present.
          for (const adicionado of adicionadosComSucesso) {
            expect(nomesResultado).toContain(adicionado);
          }
          // No extraneous values beyond seed ∪ added.
          for (const nome of nomesResultado) {
            expect(esperado).toContain(nome);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('CadastroService.remover', () => {
  // Property 27: Remoção de valor em uso é rejeitada
  // Validates: Requirements 10.5, 11.5
  it('Feature: daily-agreements, Property 27: Remoção de valor em uso é rejeitada', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(valorValidoArb, { minLength: 1, maxLength: 8 }),
        fc.nat(),
        fc.boolean(),
        async (valoresExistentes, pickIndex, emUso) => {
          const repository = new InMemoryCadastroRepository();

          // `idsEmUso` is the controllable fake standing in for
          // AcordoRepository.existsBy...Id — the property picks one seeded
          // value and decides, via `emUso`, whether it's "referenced by an
          // existing Acordo" for this run.
          const idsEmUso = new Set<string>();
          const service = new CadastroService(repository, {
            label: 'Valor',
            buildCreateInput: (valor: string) => ({ nome: valor }),
            maxLength: MAX_LENGTH,
            verificarEmUso: async (id) => idsEmUso.has(id),
          });

          // Popula o cadastro via adicionar(), obtendo ids reais atribuídos
          // pelo fake. Duplicatas case-insensitive geradas dentro do array
          // são naturalmente rejeitadas e ignoradas aqui.
          const criados: FakeRow[] = [];
          for (const valor of valoresExistentes) {
            try {
              criados.push(await service.adicionar(valor));
            } catch {
              // valor duplicado dentro do próprio array gerado — ignora
            }
          }

          // Precisa de ao menos um valor cadastrado com sucesso para
          // exercer a remoção; caso contrário, fast-check tenta outra
          // combinação de entradas.
          fc.pre(criados.length > 0);

          const alvo = criados[pickIndex % criados.length];
          if (emUso) idsEmUso.add(alvo.id);

          const antes = await repository.list();

          if (emUso) {
            // Valor referenciado por um Acordo: a remoção deve ser
            // rejeitada e o valor deve permanecer no cadastro (Requirements
            // 10.5, 11.5).
            await expect(service.remover(alvo.id)).rejects.toThrow(ConflictError);

            const depois = await repository.list();
            expect(depois).toEqual(antes);
            expect(depois.some((row) => row.id === alvo.id)).toBe(true);
          } else {
            // Valor não referenciado por nenhum Acordo: a remoção deve ser
            // aceita e o valor deve deixar de existir no cadastro.
            await service.remover(alvo.id);

            const depois = await repository.list();
            expect(depois.length).toBe(antes.length - 1);
            expect(depois.some((row) => row.id === alvo.id)).toBe(false);
          }

          // Independentemente do cenário de uso acima, remover um id que
          // não existe no cadastro sempre rejeita com NotFoundError
          // (Requirements 10.5, 11.5 pressupõem que o valor existe antes de
          // verificar o uso).
          const idInexistente = randomUUID();
          await expect(service.remover(idInexistente)).rejects.toThrow(NotFoundError);
        },
      ),
      { numRuns: 100 },
    );
  });
});
