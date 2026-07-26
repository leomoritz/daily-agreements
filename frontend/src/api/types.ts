// Tipos que espelham os modelos de dados do backend, descritos em
// design.md "Data Models" e nos schemas Prisma (backend/prisma/schema.prisma).
// Datas (`criadaEm`, `dataRegistro`, `dataRegistroAcordoAtual`) chegam do
// backend serializadas como string ISO 8601 (JSON não tem tipo Date nativo).

/** Estado de cumprimento de um Acordo (backend/prisma/schema.prisma > Acordo). */
export type EstadoCumprimento = 'pendente' | 'cumprido' | 'nao_cumprido';

/** Resultado aceito por `avaliarAcordoAtual` (backend/src/services/acordoService.ts). */
export type ResultadoAvaliacao = 'cumprido' | 'nao_cumprido';

/** Task — ver design.md "Data Models" > Task. */
export interface Task {
  id: string;
  titulo: string;
  descricao: string | null;
  responsavelId: string | null;
  numTentativas: number;
  ordemExibicao: number;
  acordoAtualId: string | null;
  concluida: boolean;
  criadaEm: string;
}

/** Acordo — ver design.md "Data Models" > Acordo. */
export interface Acordo {
  id: string;
  taskId: string;
  tipoAcordoId: string;
  dataRegistro: string;
  estadoCumprimento: EstadoCumprimento;
  motivoNaoCumprimentoId: string | null;
}

/** Tipo_de_Acordo — ver design.md "Data Models" > TipoAcordo. */
export interface TipoAcordo {
  id: string;
  nome: string;
}

/** Motivo_de_Nao_Cumprimento — ver design.md "Data Models" > MotivoNaoCumprimento. */
export interface MotivoNaoCumprimento {
  id: string;
  nome: string;
}

/** Usuário_Cadastrado — ver design.md "Data Models" > UsuarioCadastrado. */
export interface UsuarioCadastrado {
  id: string;
  nomeLogin: string;
}

/**
 * Item do grupo `taskNova[]` da Lista_de_Acordos (ver
 * backend/src/services/listaDeAcordosService.ts > TaskNovaItem,
 * Requisitos 3.3, 3.4).
 */
export interface TaskNovaItem {
  id: string;
  titulo: string;
  /** O id do Responsável atual, quando houver (Requisito 9.5). */
  responsavelId?: string;
  responsavelNome?: string;
  ordemExibicao: number;
}

/**
 * Item do grupo `taskComAcordo[]` da Lista_de_Acordos (ver
 * backend/src/services/listaDeAcordosService.ts > TaskComAcordoItem,
 * Requisitos 3.1, 3.3, 3.6).
 */
export interface TaskComAcordoItem {
  id: string;
  titulo: string;
  /** O id do Responsável atual, quando houver (Requisito 9.5). */
  responsavelId?: string;
  responsavelNome?: string;
  ordemExibicao: number;
  tipoAcordoNome: string;
  dataRegistroAcordoAtual: string;
  /** O estado de cumprimento corrente do Acordo_Atual (Requisitos 8.1, 8.4). */
  estadoCumprimentoAcordoAtual: EstadoCumprimento;
  /**
   * Indicador de alerta ativo quando o Acordo_Atual está `nao_cumprido`
   * (Requisito 3.6), e também quando o Acordo_Atual é uma repetição (via
   * "Repetir último acordo") de um Acordo não cumprido do mesmo
   * Tipo_de_Acordo — nesse fluxo o Acordo_Atual já volta a ficar
   * `pendente` no mesmo instante em que o anterior é marcado não
   * cumprido, e o alerta permanece visível mesmo assim.
   */
  alerta: boolean;
  numTentativas: number;
  /**
   * Indicador de alerta ativo quando o número de ciclos consecutivos de
   * "Avaliar e planejar" (cumprido, seguido de outro "Avaliar e
   * planejar") atinge o limite configurado. Distinto de `alerta`: nunca
   * implica que o Acordo_Atual não foi cumprido.
   */
  alertaTentativasAvaliarPlanejar: boolean;
  /** Contador de ciclos consecutivos de "Avaliar e planejar", acompanhando `alertaTentativasAvaliarPlanejar`. */
  tentativasAvaliarPlanejar: number;
  /**
   * O Ultimo_Motivo_Informado: nome do Motivo_de_Nao_Cumprimento associado
   * ao Acordo mais recente da Task que possui um Motivo_de_Nao_Cumprimento
   * associado, omitido quando nenhum Acordo da Task possui um (Requisitos
   * 2.1, 2.3, 2.5, 2.6).
   */
  ultimoMotivoNome?: string;
}

/**
 * Resultado de `GET /tasks?search=` — ambos os grupos estão sempre
 * presentes, mesmo quando vazios (Requisitos 3.2, 3.4, 8.1).
 */
export interface ListaDeAcordos {
  taskNova: TaskNovaItem[];
  taskComAcordo: TaskComAcordoItem[];
}

/**
 * Item da Lista_de_Acordos_Nao_Atualizados — ver
 * backend/src/services/listaDeAcordosService.ts > TaskNaoAtualizadaItem,
 * Requisitos 7.3–7.7, 7.10.
 */
export interface TaskNaoAtualizadaItem {
  id: string;
  titulo: string;
  responsavelId?: string;
  responsavelNome?: string;
  ordemExibicao: number;
  /** Ausente quando a Task não possui nenhum Acordo registrado (Requisitos 7.6, 7.10). */
  dataUltimaAtualizacaoAcordo?: string;
  /** Tipo_de_Acordo do Acordo_Atual, quando houver (Requisito 7.6). */
  tipoAcordoNome?: string;
}

/**
 * Item retornado por `GET /tasks/finalizadas` — ver
 * backend/src/services/atividadesFinalizadasService.ts >
 * AtividadeFinalizadaItem.
 */
export interface AtividadeFinalizadaItem {
  id: string;
  titulo: string;
  responsavelNome?: string;
  /** Data de registro do Acordo "Finalizar" (cumprido) que concluiu a Task. */
  dataFinalizacao: string;
  /** `true` quando a Task foi finalizada no dia calendário atual (servidor). */
  finalizadaHoje: boolean;
}

/**
 * Uma entrada do relatório por linha retornado por `POST /tasks/lote`
 * (ver backend/src/services/cadastroEmLoteService.ts > ResultadoLinhaLote,
 * Requisitos 12.5, 12.6).
 */
export interface ResultadoLinhaLote {
  numeroLinha: number;
  linha: string;
  aceita: boolean;
  taskId?: string;
  motivoCodigo?: string;
  motivoMensagem?: string;
}

/** Payload aceito por `criarTask` (POST /tasks). */
export interface CriarTaskInput {
  titulo: string;
  descricao?: string;
  responsavelId?: string;
}

/** Payload aceito por `editarTask` (PATCH /tasks/:id). */
export interface EditarTaskInput {
  titulo?: string;
  /** `null` ou string vazia remove o Responsável; `undefined` mantém o valor atual. */
  responsavelId?: string | null;
}

/** Payload aceito por `registrarAcordo` (POST /tasks/:id/acordos). */
export interface RegistrarAcordoInput {
  tipoAcordoId: string;
  responsavelId?: string;
  /**
   * Confirmação de que o Acordo_Atual (quando `pendente`) foi cumprido,
   * exigida pelo Registro_de_Acordo_com_Avaliacao (Requisito 8.2). Ignorada
   * quando a Task não possui Acordo_Atual pendente de avaliação.
   */
  confirmaCumprimentoAcordoAtual?: boolean;
}

/** Payload aceito por `avaliarAcordoAtual` (PATCH /tasks/:id/acordos/atual). */
export interface AvaliarAcordoAtualInput {
  resultado: ResultadoAvaliacao;
  motivoId?: string;
  /** Nome do Motivo_de_Nao_Cumprimento, resolvido/criado pelo backend (Requisitos 3.3–3.6). */
  motivoNome?: string;
}

/**
 * Payload opcional aceito por `repetirUltimoAcordo`
 * (POST /tasks/:id/acordos/repetir): o Tipo_de_Acordo e o Responsável do
 * novo Acordo continuam derivados pelo backend a partir do Acordo_Atual
 * da Task; `motivoId`/`motivoNome` associam um Motivo_de_Nao_Cumprimento
 * à avaliação do Acordo_Atual sendo repetido (Requisitos 4.2, 4.5).
 */
export interface RepetirUltimoAcordoInput {
  motivoId?: string;
  motivoNome?: string;
}
