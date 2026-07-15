// CadastroService<T> — generic domain-level service reused by the three
// configurable cadastros: Cadastro_de_Tipos_de_Acordo,
// Cadastro_de_Motivos_de_Nao_Cumprimento and Cadastro_de_Usuários. See
// design.md "Components and Interfaces" > CadastroService<T> and
// "Princípios de design" #4 (the three cadastros share the same
// validation pattern: trim, length limit, case-insensitive uniqueness,
// seeded initialization).
//
// `listar` and `adicionar` are implemented here (task 5.1). `remover`
// (task 12.1) is implemented here as well: it optionally accepts a
// `verificarEmUso` callback, wired for tipoAcordoService and
// motivoNaoCumprimentoService against AcordoRepository (Requirements
// 10.5, 11.5), and for usuarioCadastradoService against TaskRepository
// (a Usuário_Cadastrado referenced as Responsável by an existing Task
// cannot be removed, mirroring the same in-use protection pattern).

import { acordoRepository } from '../repositories/acordoRepository.js';
import type { CadastroRepository } from '../repositories/cadastroRepository.js';
import {
  motivoNaoCumprimentoRepository,
  tipoAcordoRepository,
  usuarioCadastradoRepository,
} from '../repositories/cadastroRepository.js';
import { taskRepository } from '../repositories/taskRepository.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';

/** Default length limit (chars, after trim) shared by all three cadastros. */
const VALOR_MAX_LENGTH = 100;

/** Minimal repository surface `CadastroService` depends on. */
type CadastroServiceRepository<TModel extends Record<string, unknown>, TCreateInput> = Pick<
  CadastroRepository<TModel, TCreateInput>,
  'list' | 'add' | 'existsByNameCaseInsensitive' | 'findById' | 'remove'
>;

/** Options configuring a `CadastroService` instance for a specific cadastro. */
export interface CadastroServiceOptions<TCreateInput> {
  /** Human-readable label used in error messages (e.g. "Tipo_de_Acordo"). */
  label: string;
  /** Builds the Prisma create-input from the trimmed value to add. */
  buildCreateInput: (valor: string) => TCreateInput;
  /** Length limit (chars, after trim). Defaults to 100 for all three cadastros. */
  maxLength?: number;
  /**
   * Optional in-use check invoked by `remover` before deleting a row.
   * When it resolves `true`, the removal is rejected as a conflict
   * (Requirements 10.5, 11.5). Omit for cadastros with no such
   * restriction (e.g. Cadastro_de_Usuários).
   */
  verificarEmUso?: (id: string) => Promise<boolean>;
}

export class CadastroService<TModel extends Record<string, unknown>, TCreateInput> {
  private readonly repository: CadastroServiceRepository<TModel, TCreateInput>;
  private readonly label: string;
  private readonly buildCreateInput: (valor: string) => TCreateInput;
  private readonly maxLength: number;
  private readonly verificarEmUso?: (id: string) => Promise<boolean>;

  constructor(
    repository: CadastroServiceRepository<TModel, TCreateInput>,
    options: CadastroServiceOptions<TCreateInput>,
  ) {
    this.repository = repository;
    this.label = options.label;
    this.buildCreateInput = options.buildCreateInput;
    this.maxLength = options.maxLength ?? VALOR_MAX_LENGTH;
    this.verificarEmUso = options.verificarEmUso;
  }

  /**
   * Returns all registered values, including seeded and later-added ones
   * (Requirements 10.4, 11.4, 15.6).
   */
  async listar(): Promise<TModel[]> {
    return this.repository.list();
  }

  /**
   * Adds a new value to the cadastro.
   *
   * Validates and rejects (throwing `ValidationError` or `ConflictError`) when:
   * - the trimmed value is empty (Requirements 10.3, 11.3, 15.3)
   * - the trimmed value exceeds the length limit (Requirements 10.3, 11.3, 15.4)
   * - the trimmed value already exists in the cadastro, case-insensitively
   *   (Requirements 10.3, 11.3, 15.5)
   *
   * On success (Requirements 10.2, 11.2, 15.2), adds the trimmed value to
   * the cadastro.
   */
  async adicionar(valor: string): Promise<TModel> {
    const trimmed = valor.trim();

    if (trimmed.length < 1) {
      throw new ValidationError(
        'VALOR_OBRIGATORIO',
        `${this.label} é obrigatório.`,
      );
    }

    if (trimmed.length > this.maxLength) {
      throw new ValidationError(
        'VALOR_EXCEDE_LIMITE',
        `${this.label} excede o limite máximo de ${this.maxLength} caracteres.`,
      );
    }

    const jaExiste = await this.repository.existsByNameCaseInsensitive(trimmed);
    if (jaExiste) {
      throw new ConflictError(
        'VALOR_DUPLICADO',
        `${this.label} informado já está cadastrado.`,
      );
    }

    return this.repository.add(this.buildCreateInput(trimmed));
  }

  /**
   * Removes a value from the cadastro by id.
   *
   * Validates and rejects (throwing `NotFoundError`) when the value does
   * not exist.
   *
   * ONDE a `verificarEmUso` callback foi configurada (tipoAcordoService,
   * motivoNaoCumprimentoService, usuarioCadastradoService), rejeita a
   * remoção (throwing `ConflictError`) quando o valor está em uso —
   * referenciado por algum Acordo já registrado no Sistema, no caso de
   * Tipos_de_Acordo/Motivos_de_Nao_Cumprimento (Requirements 10.5, 11.5),
   * ou referenciado como Responsável de alguma Task existente, no caso de
   * Usuário_Cadastrado.
   *
   * On success, permanently removes the value from the cadastro.
   */
  async remover(id: string): Promise<void> {
    const existente = await this.repository.findById(id);
    if (!existente) {
      throw new NotFoundError('VALOR_NAO_ENCONTRADO', `${this.label} não foi encontrado.`);
    }

    if (this.verificarEmUso) {
      const emUso = await this.verificarEmUso(id);
      if (emUso) {
        throw new ConflictError('VALOR_EM_USO', `${this.label} está em uso e não pode ser removido.`);
      }
    }

    await this.repository.remove(id);
  }
}

export const tipoAcordoService = new CadastroService(tipoAcordoRepository, {
  label: 'Tipo_de_Acordo',
  buildCreateInput: (nome) => ({ nome }),
  verificarEmUso: (id) => acordoRepository.existsByTipoAcordoId(id),
});

export const motivoNaoCumprimentoService = new CadastroService(motivoNaoCumprimentoRepository, {
  label: 'Motivo_de_Nao_Cumprimento',
  buildCreateInput: (nome) => ({ nome }),
  verificarEmUso: (id) => acordoRepository.existsByMotivoNaoCumprimentoId(id),
});

export const usuarioCadastradoService = new CadastroService(usuarioCadastradoRepository, {
  label: 'Usuário',
  buildCreateInput: (nomeLogin) => ({ nomeLogin }),
  verificarEmUso: (id) => taskRepository.existsByResponsavelId(id),
});
