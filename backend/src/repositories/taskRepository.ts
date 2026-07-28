// TaskRepository — thin data-access layer over Prisma for the Task model.
//
// This repository intentionally contains no business-rule validation
// (e.g. title length, Responsável existence). That logic belongs to
// TaskService (see design.md "Components and Interfaces"). This layer is
// only responsible for CRUD, lookup by id, and listing active Tasks.
//
// "Active" Tasks (Requirements 6.2, 9.4) are Tasks that are not concluída
// (logical removal by completion of a "Finalizar" Acordo) — manually
// deleted Tasks are physically removed from the table via `delete`, so
// they are never returned by any query.

import type { Prisma, Task } from '../../generated/prisma/index.js';
import { prisma } from '../db/prismaClient.js';

type PrismaTaskClient = typeof prisma;

/**
 * A Task with its Acordo_Atual (and the Acordo_Atual's Tipo_de_Acordo) and
 * its Responsável eagerly loaded. Used by `ListaDeAcordosService.obterLista`
 * (Requirements 3.1, 3.3), which needs both relations to build each item of
 * the Lista_de_Acordos without issuing per-Task follow-up queries.
 */
export type TaskWithAcordoAtualEResponsavel = Prisma.TaskGetPayload<{
  include: {
    acordoAtual: { include: { tipoAcordo: true } };
    responsavel: true;
  };
}>;

/**
 * A Task with its full Acordo history (each with its Tipo_de_Acordo) and
 * its Responsável eagerly loaded. Used by
 * `AtividadesFinalizadasService.obterAtividadesFinalizadas`, which needs
 * to locate the "Finalizar" Acordo (cumprido) that triggered the Task's
 * conclusão, in order to derive its data de finalização.
 */
export type TaskWithAcordosEResponsavel = Prisma.TaskGetPayload<{
  include: {
    acordos: { include: { tipoAcordo: true } };
    responsavel: true;
  };
}>;

/**
 * A Task with its Acordo_Atual (and its Tipo_de_Acordo), its Responsável,
 * and its most recent Acordo that carries a Motivo_de_Nao_Cumprimento
 * (with that Motivo) eagerly loaded. Used by
 * `ListaDeAcordosService.obterLista` to derive `ultimoMotivoNome`
 * (Requirements 2.1, 2.3) without per-Task follow-up queries.
 */
export type TaskWithAcordoAtualResponsavelEUltimoMotivo = Prisma.TaskGetPayload<{
  include: {
    acordoAtual: { include: { tipoAcordo: true } };
    responsavel: true;
    acordos: { include: { motivoNaoCumprimento: true } };
  };
}>;

/**
 * A Task with its Acordo_Atual (and its Tipo_de_Acordo), its Responsável,
 * and its single most recent Acordo (regardless of motivo) eagerly
 * loaded. Used by `ListaDeAcordosService.obterNaoAtualizados` to derive
 * `dataUltimaAtualizacaoAcordo` (Requirement 7.3) without per-Task
 * follow-up queries.
 */
export type TaskWithUltimoAcordoEResponsavel = Prisma.TaskGetPayload<{
  include: {
    acordoAtual: { include: { tipoAcordo: true } };
    responsavel: true;
    acordos: true;
  };
}>;

/** Fields accepted when creating a Task. */
export interface TaskCreateData {
  titulo: string;
  descricao?: string | null;
  responsavelId?: string | null;
  numTentativas?: number;
  /** Contador de tentativas consecutivas de Acordo_Atual "Avaliar e planejar" cumprido seguido de outro do mesmo tipo. */
  tentativasAvaliarPlanejar?: number;
  /** Sinaliza que o Acordo_Atual é uma repetição (via "Repetir último acordo") de um Acordo não cumprido do mesmo Tipo_de_Acordo — dispara alerta já na primeira repetição. */
  repeteAcordoNaoCumprido?: boolean;
  ordemExibicao: number;
  acordoAtualId?: string | null;
  concluida?: boolean;
}

/** Fields accepted when updating a Task. All fields are optional. */
export interface TaskUpdateData {
  titulo?: string;
  descricao?: string | null;
  responsavelId?: string | null;
  numTentativas?: number;
  /** Contador de tentativas consecutivas de Acordo_Atual "Avaliar e planejar" cumprido seguido de outro do mesmo tipo. */
  tentativasAvaliarPlanejar?: number;
  /** Sinaliza que o Acordo_Atual é uma repetição (via "Repetir último acordo") de um Acordo não cumprido do mesmo Tipo_de_Acordo — dispara alerta já na primeira repetição. */
  repeteAcordoNaoCumprido?: boolean;
  ordemExibicao?: number;
  acordoAtualId?: string | null;
  concluida?: boolean;
}

export class TaskRepository {
  private readonly prisma: PrismaTaskClient;

  constructor(prismaClient: PrismaTaskClient = prisma) {
    this.prisma = prismaClient;
  }

  /** Creates a new Task row. (Requirement 1.4) */
  async create(data: TaskCreateData): Promise<Task> {
    return this.prisma.task.create({ data });
  }

  /** Finds a Task by id, or null if it does not exist. */
  async findById(id: string): Promise<Task | null> {
    return this.prisma.task.findUnique({ where: { id } });
  }

  /** Updates a Task by id. Throws if the Task does not exist. */
  async update(id: string, data: TaskUpdateData): Promise<Task> {
    return this.prisma.task.update({ where: { id }, data });
  }

  /**
   * Physically deletes a Task by id. The Acordo rows referencing this Task
   * cascade-delete at the database level (Requirement 9.4, enforced by
   * `onDelete: Cascade` in schema.prisma).
   */
  async delete(id: string): Promise<void> {
    await this.prisma.task.delete({ where: { id } });
  }

  /**
   * Lists active Tasks: not concluída (Requirement 6.2). Manually removed
   * Tasks (Requirement 9.4) are physically deleted, so they are already
   * excluded from the table and never appear here.
   */
  async listActive(): Promise<Task[]> {
    return this.prisma.task.findMany({ where: { concluida: false } });
  }

  /**
   * Lists active Tasks (not concluída — Requirement 6.2; manually removed
   * Tasks are physically deleted, so they never appear here either),
   * eagerly loading each Task's Acordo_Atual (with its Tipo_de_Acordo) and
   * Responsável. Used by `ListaDeAcordosService.obterLista` (Requirements
   * 3.1, 3.3) to build each Lista_de_Acordos item without per-Task
   * follow-up queries.
   */
  async listActiveWithAcordoAtualEResponsavel(): Promise<TaskWithAcordoAtualEResponsavel[]> {
    return this.prisma.task.findMany({
      where: { concluida: false },
      include: {
        acordoAtual: { include: { tipoAcordo: true } },
        responsavel: true,
      },
    });
  }

  /**
   * Lists active Tasks (not concluída — Requirement 6.2), eagerly loading
   * each Task's Acordo_Atual (with its Tipo_de_Acordo), Responsável, and
   * its most recent Acordo that carries a Motivo_de_Nao_Cumprimento (with
   * that Motivo). Used by `ListaDeAcordosService.obterLista` (Requirements
   * 2.1, 2.3) to derive `ultimoMotivoNome` without per-Task follow-up
   * queries.
   */
  async listActiveWithAcordoAtualResponsavelEUltimoMotivo(): Promise<
    TaskWithAcordoAtualResponsavelEUltimoMotivo[]
  > {
    return this.prisma.task.findMany({
      where: { concluida: false },
      include: {
        acordoAtual: { include: { tipoAcordo: true } },
        responsavel: true,
        acordos: {
          where: { motivoNaoCumprimentoId: { not: null } },
          include: { motivoNaoCumprimento: true },
          orderBy: [{ dataRegistro: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
    });
  }

  /**
   * Lists active Tasks (not concluída — Requirement 6.2), eagerly loading
   * each Task's Acordo_Atual (with its Tipo_de_Acordo), Responsável, and
   * its single most recent Acordo (regardless of motivo). Used by
   * `ListaDeAcordosService.obterNaoAtualizados` (Requirement 7.3) to
   * derive `dataUltimaAtualizacaoAcordo` without per-Task follow-up
   * queries.
   */
  async listActiveWithUltimoAcordoEResponsavel(): Promise<TaskWithUltimoAcordoEResponsavel[]> {
    return this.prisma.task.findMany({
      where: { concluida: false },
      include: {
        acordoAtual: { include: { tipoAcordo: true } },
        responsavel: true,
        acordos: {
          orderBy: [{ dataRegistro: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
    });
  }

  /**
   * Lists concluída Tasks (Requirement 6.2/6.3 — logical removal by
   * completion), eagerly loading each Task's full Acordo history (with
   * each Acordo's Tipo_de_Acordo) and Responsável. Used by
   * `AtividadesFinalizadasService.obterAtividadesFinalizadas` to build
   * the "Atividades Finalizadas" view, including the data de finalização
   * derived from the "Finalizar" Acordo (cumprido).
   */
  async listConcluidasWithAcordosEResponsavel(): Promise<TaskWithAcordosEResponsavel[]> {
    return this.prisma.task.findMany({
      where: { concluida: true },
      include: {
        acordos: { include: { tipoAcordo: true } },
        responsavel: true,
      },
    });
  }

  /**
   * Checks whether any Task (including concluída/logically-removed ones —
   * a manually-removed Task is physically deleted and never counted here,
   * but a Task hidden only by conclusão still holds its history and
   * should still block removal of the Usuário it references) references
   * the given Usuário_Cadastrado id as Responsável. Used by
   * `CadastroService.remover` to reject removal of a Usuário_Cadastrado
   * still in use as Responsável.
   */
  async existsByResponsavelId(responsavelId: string): Promise<boolean> {
    const count = await this.prisma.task.count({ where: { responsavelId } });
    return count > 0;
  }
}

/** Shared singleton instance, wired to the default (Prisma-backed) client. */
export const taskRepository = new TaskRepository();
