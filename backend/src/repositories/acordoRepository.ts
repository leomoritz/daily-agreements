// AcordoRepository — thin data-access layer over Prisma for the Acordo model.
//
// This repository intentionally contains no business-rule validation
// (e.g. rejecting registration while an Acordo_Atual is pending, or
// incrementing Nº_Tentativas on non-cumprimento). That logic belongs to
// AcordoService (see design.md "Components and Interfaces"). This layer is
// only responsible for creating Acordo rows, lookup by id, returning the
// full history of Acordos for a Task, and checking whether a
// Tipo_de_Acordo/Motivo_de_Nao_Cumprimento is referenced by any Acordo
// (used by CadastroService.remover's in-use check, task 12.1,
// Requirements 10.5, 11.5).
//
// `create` only ever inserts a new row and never updates an existing one,
// which is what preserves previous Acordos in history when a Task's
// Acordo_Atual is replaced (Requirement 7.3) — the caller (AcordoService)
// is responsible for pointing Task.acordoAtualId at the new row.

import type { Acordo } from '../../generated/prisma/index.js';
import { prisma } from '../db/prismaClient.js';

type PrismaAcordoClient = typeof prisma;

/** Fields accepted when creating an Acordo. */
export interface AcordoCreateData {
  taskId: string;
  tipoAcordoId: string;
  responsavelId?: string | null;
  dataRegistro?: Date;
  estadoCumprimento?: string;
  motivoNaoCumprimentoId?: string | null;
}

/** Fields accepted when updating an Acordo. All fields are optional. */
export interface AcordoUpdateData {
  estadoCumprimento?: string;
  motivoNaoCumprimentoId?: string | null;
}

export class AcordoRepository {
  private readonly prisma: PrismaAcordoClient;

  constructor(prismaClient: PrismaAcordoClient = prisma) {
    this.prisma = prismaClient;
  }

  /**
   * Creates a new Acordo row. Only ever inserts — never updates an
   * existing row — so previous Acordos are preserved in history when a
   * Task's Acordo_Atual is replaced (Requirement 7.3).
   */
  async create(data: AcordoCreateData): Promise<Acordo> {
    return this.prisma.acordo.create({ data });
  }

  /** Finds an Acordo by id, or null if it does not exist. */
  async findById(id: string): Promise<Acordo | null> {
    return this.prisma.acordo.findUnique({ where: { id } });
  }

  /**
   * Returns all Acordo rows for the given Task, ordered by `dataRegistro`
   * ascending (oldest to newest), including the current one (Requirement
   * 7.1). Returns an empty list when the Task has no Acordos (Requirement
   * 7.2 is satisfied by returning the full row, which already carries
   * tipoAcordoId, dataRegistro and estadoCumprimento).
   */
  async findHistoryByTaskId(taskId: string): Promise<Acordo[]> {
    return this.prisma.acordo.findMany({
      where: { taskId },
      orderBy: { dataRegistro: 'asc' },
    });
  }

  /** Updates an Acordo by id. Throws if the Acordo does not exist. */
  async update(id: string, data: AcordoUpdateData): Promise<Acordo> {
    return this.prisma.acordo.update({ where: { id }, data });
  }

  /**
   * Checks whether any Acordo references the given Tipo_de_Acordo id.
   * Used by `CadastroService.remover` to reject removal of a
   * Tipo_de_Acordo still in use (Requirement 10.5).
   */
  async existsByTipoAcordoId(tipoAcordoId: string): Promise<boolean> {
    const count = await this.prisma.acordo.count({ where: { tipoAcordoId } });
    return count > 0;
  }

  /**
   * Checks whether any Acordo references the given Motivo_de_Nao_Cumprimento
   * id. Used by `CadastroService.remover` to reject removal of a
   * Motivo_de_Nao_Cumprimento still in use (Requirement 11.5).
   */
  async existsByMotivoNaoCumprimentoId(motivoNaoCumprimentoId: string): Promise<boolean> {
    const count = await this.prisma.acordo.count({ where: { motivoNaoCumprimentoId } });
    return count > 0;
  }
}

/** Shared singleton instance, wired to the default (Prisma-backed) client. */
export const acordoRepository = new AcordoRepository();
