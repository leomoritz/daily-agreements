// API client — funções tipadas para todas as rotas REST do backend
// (ver design.md "Backend — API REST (contratos)"). Cada função aqui
// corresponde a exatamente uma rota, encapsulando método HTTP, path,
// query params e corpo da requisição/resposta.
//
// Erros seguem o formato padrão do backend
// `{ "erro": { "codigo", "mensagem" } }` e chegam aqui já traduzidos para
// `ApiError` pelo fetch wrapper (ver ./http.ts).

import { request } from './http';
import type {
  Acordo,
  AtividadeFinalizadaItem,
  AvaliarAcordoAtualInput,
  CriarTaskInput,
  EditarTaskInput,
  ListaDeAcordos,
  MotivoNaoCumprimento,
  RegistrarAcordoInput,
  RepetirUltimoAcordoInput,
  ResultadoLinhaLote,
  Task,
  TaskNaoAtualizadaItem,
  TipoAcordo,
  UsuarioCadastrado,
} from './types';

// --- Timeouts (Requisitos 3.9, 7.11, 10.10) -----------------------------
//
// O wrapper de fetch (./http.ts) aborta a requisição via `AbortController`
// quando o tempo é excedido, traduzindo em uma `ApiError` de falha de
// comunicação — tratada pelas telas como qualquer outra rejeição da API.

/** Timeout das operações que mutam um Acordo (Requisitos 3.9, 4.8, 8.5, 10.4). */
const TIMEOUT_OPERACAO_DE_ACORDO_MS = 30_000;

/** Timeout da consulta à Lista_de_Acordos_Nao_Atualizados (Requisito 7.11). */
const TIMEOUT_NAO_ATUALIZADOS_MS = 3_000;

/** Timeout do recarregamento da Lista_de_Acordos (Requisito 10.10). */
const TIMEOUT_RECARREGAMENTO_LISTA_MS = 10_000;

// --- Tasks --------------------------------------------------------------

/** POST /tasks — cria uma Task (Requisito 1). */
export function criarTask(input: CriarTaskInput): Promise<Task> {
  return request<Task>('/tasks', { method: 'POST', body: input });
}

/** GET /tasks?search= — retorna a Lista_de_Acordos (Requisitos 3, 8, 13). */
export function obterLista(search?: string): Promise<ListaDeAcordos> {
  return request<ListaDeAcordos>('/tasks', {
    query: { search },
    timeoutMs: TIMEOUT_RECARREGAMENTO_LISTA_MS,
  });
}

/** PATCH /tasks/:id — edita título e/ou Responsável (Requisito 9.1, 9.2, 9.6, 9.7). */
export function editarTask(taskId: string, input: EditarTaskInput): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: input });
}

/** DELETE /tasks/:id — remove a Task manualmente (exclusão física) (Requisito 9.4, 9.5). */
export function removerTask(taskId: string): Promise<void> {
  return request<void>(`/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

/** PUT /tasks/:id/ordem — reordena a Task para uma nova posição (Requisito 14). */
export function reordenarTask(taskId: string, novaPosicao: number): Promise<void> {
  return request<void>(`/tasks/${encodeURIComponent(taskId)}/ordem`, {
    method: 'PUT',
    body: { novaPosicao },
  });
}

/** GET /tasks/:id/historico — retorna o histórico de Acordos da Task (Requisito 7). */
export function buscarHistorico(taskId: string): Promise<Acordo[]> {
  return request<Acordo[]>(`/tasks/${encodeURIComponent(taskId)}/historico`);
}

/**
 * POST /tasks/:id/acordos — registra um novo Acordo (primeiro ou próximo)
 * (Requisitos 2, 5); com Acordo_Atual pendente e
 * `confirmaCumprimentoAcordoAtual: true`, executa o
 * Registro_de_Acordo_com_Avaliacao (Requisito 8.2).
 */
export function registrarAcordo(taskId: string, input: RegistrarAcordoInput): Promise<Acordo> {
  return request<Acordo>(`/tasks/${encodeURIComponent(taskId)}/acordos`, {
    method: 'POST',
    body: input,
    timeoutMs: TIMEOUT_OPERACAO_DE_ACORDO_MS,
  });
}

/** PATCH /tasks/:id/acordos/atual — avalia o Acordo_Atual (Requisitos 3, 4, 6). */
export function avaliarAcordoAtual(
  taskId: string,
  input: AvaliarAcordoAtualInput,
): Promise<Acordo> {
  return request<Acordo>(`/tasks/${encodeURIComponent(taskId)}/acordos/atual`, {
    method: 'PATCH',
    body: input,
    timeoutMs: TIMEOUT_OPERACAO_DE_ACORDO_MS,
  });
}

/**
 * POST /tasks/:id/acordos/repetir — "Repetir último acordo": avalia o
 * Acordo_Atual (cumprido se "Avaliar e planejar", não cumprido nos demais
 * casos) e registra um novo Acordo do mesmo Tipo_de_Acordo, mantendo o
 * Responsável atual da Task. Aceita opcionalmente `{ motivoId?,
 * motivoNome? }`, associado à avaliação do Acordo_Atual sendo repetido
 * (Requisitos 4.2, 4.5).
 */
export function repetirUltimoAcordo(
  taskId: string,
  input?: RepetirUltimoAcordoInput,
): Promise<Acordo> {
  return request<Acordo>(`/tasks/${encodeURIComponent(taskId)}/acordos/repetir`, {
    method: 'POST',
    body: input,
    timeoutMs: TIMEOUT_OPERACAO_DE_ACORDO_MS,
  });
}

/**
 * POST /tasks/:id/finalizar — "Finalizar": marca o Acordo_Atual da Task
 * como cumprido e finaliza a atividade (marca a Task como concluída),
 * independentemente do Tipo_de_Acordo do Acordo_Atual.
 */
export function finalizarTask(taskId: string): Promise<Acordo> {
  return request<Acordo>(`/tasks/${encodeURIComponent(taskId)}/finalizar`, {
    method: 'POST',
    timeoutMs: TIMEOUT_OPERACAO_DE_ACORDO_MS,
  });
}

/** POST /tasks/lote — cadastro em lote a partir de texto colado (Requisito 12). */
export function processarLote(texto: string): Promise<ResultadoLinhaLote[]> {
  return request<ResultadoLinhaLote[]>('/tasks/lote', { method: 'POST', body: { texto } });
}

/** GET /tasks/finalizadas — retorna as Atividades_Finalizadas (Tasks concluídas). */
export function obterAtividadesFinalizadas(): Promise<AtividadeFinalizadaItem[]> {
  return request<AtividadeFinalizadaItem[]>('/tasks/finalizadas');
}

/** GET /tasks/nao-atualizados — retorna a Lista_de_Acordos_Nao_Atualizados (Requisito 7). */
export function obterAcordosNaoAtualizados(): Promise<TaskNaoAtualizadaItem[]> {
  return request<TaskNaoAtualizadaItem[]>('/tasks/nao-atualizados', {
    timeoutMs: TIMEOUT_NAO_ATUALIZADOS_MS,
  });
}

// --- Cadastro_de_Tipos_de_Acordo ----------------------------------------

/** GET /tipos-de-acordo — lista os Tipos_de_Acordo cadastrados (Requisito 10). */
export function listarTiposDeAcordo(): Promise<TipoAcordo[]> {
  return request<TipoAcordo[]>('/tipos-de-acordo');
}

/** POST /tipos-de-acordo — adiciona um novo Tipo_de_Acordo (Requisito 10.2, 10.3). */
export function adicionarTipoDeAcordo(nome: string): Promise<TipoAcordo> {
  return request<TipoAcordo>('/tipos-de-acordo', { method: 'POST', body: { nome } });
}

/** DELETE /tipos-de-acordo/:id — remove um Tipo_de_Acordo, se não estiver em uso (Requisito 10.5). */
export function removerTipoDeAcordo(id: string): Promise<void> {
  return request<void>(`/tipos-de-acordo/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// --- Cadastro_de_Motivos_de_Nao_Cumprimento -----------------------------

/** GET /motivos-de-nao-cumprimento — lista os Motivos_de_Nao_Cumprimento cadastrados (Requisito 11). */
export function listarMotivos(): Promise<MotivoNaoCumprimento[]> {
  return request<MotivoNaoCumprimento[]>('/motivos-de-nao-cumprimento');
}

/** POST /motivos-de-nao-cumprimento — adiciona um novo Motivo_de_Nao_Cumprimento (Requisito 11.2, 11.3). */
export function adicionarMotivo(nome: string): Promise<MotivoNaoCumprimento> {
  return request<MotivoNaoCumprimento>('/motivos-de-nao-cumprimento', {
    method: 'POST',
    body: { nome },
  });
}

/** DELETE /motivos-de-nao-cumprimento/:id — remove um motivo, se não estiver em uso (Requisito 11.5). */
export function removerMotivo(id: string): Promise<void> {
  return request<void>(`/motivos-de-nao-cumprimento/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// --- Cadastro_de_Usuários ------------------------------------------------

/** GET /usuarios — lista os Usuário_Cadastrado cadastrados (Requisito 15). */
export function listarUsuarios(): Promise<UsuarioCadastrado[]> {
  return request<UsuarioCadastrado[]>('/usuarios');
}

/** POST /usuarios — adiciona um novo Usuário_Cadastrado (Requisito 15.2-15.5). */
export function adicionarUsuario(nomeLogin: string): Promise<UsuarioCadastrado> {
  return request<UsuarioCadastrado>('/usuarios', { method: 'POST', body: { nomeLogin } });
}

/** DELETE /usuarios/:id — remove um Usuário_Cadastrado, se não estiver em uso como Responsável. */
export function removerUsuario(id: string): Promise<void> {
  return request<void>(`/usuarios/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
