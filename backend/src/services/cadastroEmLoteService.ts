// CadastroEmLoteService — domain logic for batch Task registration from a
// pasted block of text (Requisito 12, design.md "Components and
// Interfaces" > CadastroEmLoteService).
//
// `processarLote(texto)` (task 17.1):
// - splits `texto` into lines (Requirement 12.1), processing each line
//   independently, in the same order they appear in the original text;
// - for a line containing ";", the part before the first ";" is the
//   título and the (trimmed) part after it is the Tipo_de_Acordo name to
//   look up (Requirement 12.2); for a line without ";", the whole
//   (trimmed) título is used and the Task is created with no Acordo,
//   i.e. as a Task_Nova (Requirement 12.3);
// - reuses `TaskService.criarTask` to validate the título against the
//   very same limits as Requisito 1 (trim, 1-200 chars — Requirement
//   12.4) and to create the Task (with `ordemExibicao` at the end of the
//   current active list);
// - when a Tipo_de_Acordo name was parsed, it must be resolved against
//   the Cadastro_de_Tipos_de_Acordo case-insensitively *before* the Task
//   is created: if it doesn't resolve, the whole line is rejected
//   (Requirement 12.6) and no Task is created for it; if it does
//   resolve, the Task is created and then `AcordoService.registrarAcordo`
//   is called for it, registering that Acordo as the Task's Acordo_Atual
//   and classifying the Task as Task_Com_Acordo (Requirement 12.7);
// - a line whose título is invalid (empty after trim, or over 200 chars)
//   is rejected individually — via the `ValidationError` thrown by
//   `criarTask` — without aborting the processing of the remaining lines
//   of the same batch (Requirement 12.5);
// - lines are processed strictly sequentially (not concurrently): since
//   `criarTask` assigns each new Task's `ordemExibicao` at the end of the
//   active list at the moment it runs, processing one line fully
//   (Task creation and, when applicable, Acordo registration) before
//   starting the next guarantees that Tasks created from valid lines end
//   up with `ordemExibicao` values in the same relative order as their
//   lines in the original text (Requirement 12.8), with no race between
//   concurrent single-Task creations;
// - returns a report with one entry per line, indicating whether it was
//   accepted (with the created Task's id) or rejected (with the
//   rejection's código/mensagem), regardless of how many other lines in
//   the same batch were accepted or rejected.

import type { AcordoService } from './acordoService.js';
import type { CadastroRepository } from '../repositories/cadastroRepository.js';
import { tipoAcordoRepository } from '../repositories/cadastroRepository.js';
import { acordoService as acordoServiceSingleton } from './acordoService.js';
import { AppError, ValidationError } from './errors.js';
import type { TaskService } from './taskService.js';
import { taskService as taskServiceSingleton } from './taskService.js';

/** Character that separates título and Tipo_de_Acordo within a batch line (Requirement 12.2). */
const SEPARADOR_TIPO_ACORDO = ';';

/** One entry of the per-line report returned by `processarLote` (Requirements 12.5, 12.6). */
export interface ResultadoLinhaLote {
  /** 1-based position of this line within the original text. */
  numeroLinha: number;
  /** The original line text, exactly as it appeared in the input (not trimmed). */
  linha: string;
  /** Whether the line's Task was accepted (created) or rejected. */
  aceita: boolean;
  /** Present when `aceita` is true: the id of the Task created for this line. */
  taskId?: string;
  /** Present when `aceita` is false: the código of the rejection reason. */
  motivoCodigo?: string;
  /** Present when `aceita` is false: a human-readable rejection reason. */
  motivoMensagem?: string;
}

export class CadastroEmLoteService {
  private readonly taskService: Pick<TaskService, 'criarTask'>;
  private readonly acordoService: Pick<AcordoService, 'registrarAcordo'>;
  private readonly tipoAcordoRepository: Pick<
    CadastroRepository<{ id: string; nome?: string }, unknown>,
    'findByNomeCaseInsensitive'
  >;

  constructor(
    taskService: Pick<TaskService, 'criarTask'> = taskServiceSingleton,
    acordoService: Pick<AcordoService, 'registrarAcordo'> = acordoServiceSingleton,
    tipoAcordoRepo: Pick<
      CadastroRepository<{ id: string; nome?: string }, unknown>,
      'findByNomeCaseInsensitive'
    > = tipoAcordoRepository,
  ) {
    this.taskService = taskService;
    this.acordoService = acordoService;
    this.tipoAcordoRepository = tipoAcordoRepo;
  }

  /**
   * Processes a pasted block of text as a batch of Task registrations,
   * one per line, in the same order they appear in `texto` (Requirement
   * 12.1).
   *
   * Never throws: every per-line failure (invalid título, unresolved
   * Tipo_de_Acordo) is captured and reported as a rejected entry, without
   * interrupting the processing of the remaining lines (Requirements
   * 12.5, 12.6).
   *
   * Returns one `ResultadoLinhaLote` per line, in the same order as the
   * input lines.
   */
  async processarLote(texto: string): Promise<ResultadoLinhaLote[]> {
    const linhas = texto.split(/\r\n|\r|\n/);
    const resultados: ResultadoLinhaLote[] = [];

    for (let i = 0; i < linhas.length; i += 1) {
      const linha = linhas[i]!;
      const numeroLinha = i + 1;

      try {
        const taskId = await this.processarLinha(linha);
        resultados.push({ numeroLinha, linha, aceita: true, taskId });
      } catch (error) {
        const { codigo, mensagem } = this.descreverErro(error);
        resultados.push({
          numeroLinha,
          linha,
          aceita: false,
          motivoCodigo: codigo,
          motivoMensagem: mensagem,
        });
      }
    }

    return resultados;
  }

  /**
   * Parses and processes a single line, returning the id of the created
   * Task on success. Throws (typically `ValidationError`) when the línea
   * should be rejected — either because the título is invalid (surfaced
   * by `criarTask`, Requirement 12.4/12.5) or because the Tipo_de_Acordo
   * named after ";" does not exist in the Cadastro_de_Tipos_de_Acordo
   * (Requirement 12.6).
   *
   * The Tipo_de_Acordo, when present, is resolved *before* the Task is
   * created, so an invalid Tipo_de_Acordo never leaves behind a Task
   * without its intended Acordo (Requirement 12.6 rejects the whole
   * line, not just the Acordo).
   */
  private async processarLinha(linha: string): Promise<string> {
    const indiceSeparador = linha.indexOf(SEPARADOR_TIPO_ACORDO);
    const temTipoAcordo = indiceSeparador >= 0;
    const titulo = temTipoAcordo ? linha.slice(0, indiceSeparador) : linha;

    let tipoAcordoId: string | undefined;
    if (temTipoAcordo) {
      const tipoAcordoNome = linha.slice(indiceSeparador + 1).trim();
      const tipoAcordo = await this.tipoAcordoRepository.findByNomeCaseInsensitive(tipoAcordoNome);
      if (!tipoAcordo) {
        throw new ValidationError(
          'TIPO_ACORDO_INVALIDO',
          'O Tipo_de_Acordo informado é inválido.',
        );
      }
      tipoAcordoId = tipoAcordo.id;
    }

    const task = await this.taskService.criarTask({ titulo });

    if (tipoAcordoId) {
      await this.acordoService.registrarAcordo(task.id, tipoAcordoId);
    }

    return task.id;
  }

  /** Extracts a `{ codigo, mensagem }` pair from a thrown error for the per-line report. */
  private descreverErro(error: unknown): { codigo: string; mensagem: string } {
    if (error instanceof AppError) {
      return { codigo: error.codigo, mensagem: error.message };
    }
    return {
      codigo: 'ERRO_DESCONHECIDO',
      mensagem: 'Não foi possível processar esta linha.',
    };
  }
}

/** Shared singleton instance, wired to the default (Prisma-backed) services and repository. */
export const cadastroEmLoteService = new CadastroEmLoteService();
