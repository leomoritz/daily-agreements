// CadastroRepository<T> — generic, reusable thin data-access layer over
// Prisma for the three "cadastro" reference models: TipoAcordo,
// MotivoNaoCumprimento and UsuarioCadastrado (Requirements 10.4, 11.4,
// 15.6). All three share the same shape of operations (list, add, remove,
// check existence by name case-insensitively, find by id) even though
// each has a distinct Prisma delegate type — this class is parameterized
// over the row type and its Prisma create-input type, and is constructed
// with the specific delegate (e.g. `prisma.tipoAcordo`) plus the name of
// the field that holds the human-readable name (`nome` or `nomeLogin`).
//
// This repository intentionally contains no business-rule validation
// (trimming, length limits, uniqueness enforcement, etc). That logic
// belongs to CadastroService (see design.md "Components and
// Interfaces"). This layer is only responsible for persistence.

import { prisma } from '../db/prismaClient.js';

/**
 * Minimal structural shape a Prisma model delegate must satisfy to be
 * usable by CadastroRepository. `prisma.tipoAcordo`,
 * `prisma.motivoNaoCumprimento` and `prisma.usuarioCadastrado` all
 * satisfy this shape.
 */
export interface CadastroDelegate<TModel, TCreateInput> {
  findMany(): Promise<TModel[]>;
  create(args: { data: TCreateInput }): Promise<TModel>;
  delete(args: { where: { id: string } }): Promise<TModel>;
  findUnique(args: { where: { id: string } }): Promise<TModel | null>;
}

export class CadastroRepository<TModel extends Record<string, unknown>, TCreateInput> {
  private readonly delegate: CadastroDelegate<TModel, TCreateInput>;
  private readonly nameField: keyof TModel & string;

  constructor(delegate: CadastroDelegate<TModel, TCreateInput>, nameField: keyof TModel & string) {
    this.delegate = delegate;
    this.nameField = nameField;
  }

  /**
   * Returns all registered rows, including seeded and later-added ones
   * (Requirements 10.4, 11.4, 15.6).
   */
  async list(): Promise<TModel[]> {
    return this.delegate.findMany();
  }

  /** Creates a new row. */
  async add(data: TCreateInput): Promise<TModel> {
    return this.delegate.create({ data });
  }

  /** Deletes a row by id. Throws if the row does not exist. */
  async remove(id: string): Promise<void> {
    await this.delegate.delete({ where: { id } });
  }

  /** Finds a row by id, or null if it does not exist. */
  async findById(id: string): Promise<TModel | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  /**
   * Checks whether a row with the given name-field value exists,
   * case-insensitively. SQLite's `mode: 'insensitive'` query filter is
   * not supported by Prisma for the sqlite provider, so comparison is
   * done in JS after fetching all rows — an acceptable trade-off for
   * these small reference tables.
   */
  async existsByNameCaseInsensitive(nome: string): Promise<boolean> {
    const rows = await this.list();
    const target = nome.toLowerCase();
    return rows.some((row) => String(row[this.nameField]).toLowerCase() === target);
  }

  /**
   * Finds the row whose name-field value matches `nome` case-insensitively,
   * or null if no such row exists. Used by CadastroEmLoteService (task
   * 17.1) to resolve a Tipo_de_Acordo name parsed from a batch line into
   * its id (Requirements 12.2, 12.6). Like `existsByNameCaseInsensitive`,
   * comparison is done in JS after fetching all rows (see that method's
   * comment for why).
   */
  async findByNomeCaseInsensitive(nome: string): Promise<TModel | null> {
    const rows = await this.list();
    const target = nome.toLowerCase();
    return rows.find((row) => String(row[this.nameField]).toLowerCase() === target) ?? null;
  }
}

export const tipoAcordoRepository = new CadastroRepository(prisma.tipoAcordo, 'nome');
export const motivoNaoCumprimentoRepository = new CadastroRepository(prisma.motivoNaoCumprimento, 'nome');
export const usuarioCadastradoRepository = new CadastroRepository(prisma.usuarioCadastrado, 'nomeLogin');
