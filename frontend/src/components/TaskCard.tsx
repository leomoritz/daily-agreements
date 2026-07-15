// TaskCard — exibe uma Task na Lista_de_Acordos (design.md > Frontend
// Components > TaskCard). Recebe um item do grupo `taskNova[]` ou
// `taskComAcordo[]` retornado por `GET /tasks` (ver src/api/types.ts) e
// renderiza os campos aplicáveis a cada grupo.
//
// Requisito 3.1: para Task_Com_Acordo, exibe título, Tipo_de_Acordo, data
// de registro do Acordo_Atual e Responsável (quando houver).
// Requisito 3.3: para Task_Nova, exibe título e Responsável (quando houver).
// Requisito 3.6: quando o Acordo_Atual estiver não cumprido (`alerta`),
// exibe um indicador visual de alerta (fundo vermelho) e o Nº_Tentativas —
// sem depender apenas da cor, um texto/aria-label também comunica o alerta.
//
// Requisito 9.1/9.2/9.6/9.7 (edição de título/Responsável, tarefa 27.1):
// quando `onTaskEditada` é informado, um botão "Editar" alterna o card
// para um modo de edição com um campo de texto (título) e um select de
// Responsável (carregado via `listarUsuarios()`), submetendo para
// `PATCH /tasks/:id`. Erros de validação (Requisito 9.2 — título vazio;
// 9.7 — Responsável inválido) são exibidos dentro do próprio formulário
// de edição sem descartar o que o usuário digitou/selecionou, permitindo
// corrigir e tentar novamente.
//
// Nota de design: os itens de `taskNova[]`/`taskComAcordo[]` só trazem
// `responsavelNome` (não `responsavelId`) — a lista de Tasks foi
// desenhada para exibição, não para edição. Por isso, ao entrar em modo
// de edição, o Responsável atual é pré-selecionado comparando
// `responsavelNome` com o `nomeLogin` dos Usuários cadastrados
// (correspondência exata); se nenhum Usuário corresponder (ex.: nome
// alterado/removido do cadastro), o campo simplesmente inicia sem
// seleção, deixando o usuário escolher livremente. Pelo mesmo motivo, o
// resultado da edição é comunicado ao chamador (`onTaskEditada`) como
// `{ titulo, responsavelNome }` — já resolvido a partir do Usuário
// selecionado — em vez da `Task` crua retornada pela API (que só tem
// `responsavelId`), permitindo que a página atualize o item exibido sem
// precisar refazer essa resolução.
//
// Requisito 9.4/9.5 (remoção manual): o botão "Remover" exige uma
// confirmação explícita (Requisito de segurança geral, não específico da
// tarefa) antes de chamar `DELETE /tasks/:id`; erros são exibidos inline.
//
// Wiring final do frontend (tarefa 28.1): quando `onAcordoAlterado` é
// informado, o card ganha ações adicionais para conectar os formulários
// de Acordo e o modal de histórico (implementados nas tarefas 23/24, mas
// ainda não conectados à página principal):
// - "Registrar Acordo": abre `RegistrarAcordoForm` inline. Exibida para
//   toda Task — tanto para Task_Nova (primeiro Acordo, Requisitos 2.1,
//   2.2) quanto para Task_Com_Acordo (próximo Acordo, Requisitos 5.1,
//   5.2, 5.6, 5.7, 5.8).
// - "Avaliar": abre `AvaliarAcordoForm` inline. Exibida somente para
//   Task_Com_Acordo (Requisitos 4.1, 4.2, 4.5, 4.6, 4.7).
// - "Repetir último acordo": chama diretamente
//   `POST /tasks/:id/acordos/repetir` (sem painel/formulário, já que não
//   há campos a coletar — o backend deriva Tipo_de_Acordo e Responsável a
//   partir do Acordo_Atual). Exibida somente para Task_Com_Acordo. Se o
//   Acordo_Atual for "Avaliar e planejar", o backend o marca cumprido e
//   registra outro "Avaliar e planejar"; para qualquer outro
//   Tipo_de_Acordo, o backend o marca não cumprido e registra um novo
//   Acordo do mesmo tipo — em ambos os casos mantendo o Responsável atual.
// - "Ver histórico": abre `TaskHistoricoModal` (Requisito 7). Exibida
//   para toda Task, independente de `onAcordoAlterado` — o modal é
//   somente leitura e não precisa disparar um refresh da lista.
// - "Finalizar": chama diretamente `POST /tasks/:id/finalizar`. Exibida
//   somente para Task_Com_Acordo (Task_Nova não possui Acordo_Atual para
//   marcar como cumprido). O backend marca o Acordo_Atual como cumprido e
//   finaliza a atividade (`Task.concluida = true`) num único passo,
//   independentemente do Tipo_de_Acordo do Acordo_Atual.
//
// Nota de design: o item da lista não expõe se o Acordo_Atual de uma
// Task_Com_Acordo está pendente ou já avaliado (só expõe `alerta` e
// `numTentativas`) — por isso "Avaliar" e "Registrar Acordo" ficam
// ambas visíveis para toda Task_Com_Acordo, e a validação de qual delas
// pode realmente ser concluída no momento é delegada à API (que já
// retorna um erro claro quando a ação não é aplicável ao estado atual:
// Requisitos 2.5/5.5 para registrar com Acordo_Atual pendente, 4.8 para
// avaliar sem Acordo_Atual).
//
// Após um registro/avaliação aceito pela API, o painel correspondente é
// fechado e `onAcordoAlterado` é chamado para que a página recarregue a
// lista completa do servidor (mais simples e correto do que tentar
// reclassificar/atualizar o item localmente, já que o backend já calcula
// isso em `ListaDeAcordosService`).

import { useState, type FormEvent } from 'react';
import { editarTask, finalizarTask, listarUsuarios, removerTask, repetirUltimoAcordo } from '../api/client';
import { ApiError } from '../api/errors';
import type { TaskComAcordoItem, TaskNovaItem, UsuarioCadastrado } from '../api/types';
import { AvaliarAcordoForm } from './AvaliarAcordoForm';
import { RegistrarAcordoForm } from './RegistrarAcordoForm';
import { TaskHistoricoModal } from './TaskHistoricoModal';
import './TaskCard.css';

/** Resultado de uma edição aceita pela API, já resolvido para exibição. */
export interface TaskEdicaoResultado {
  titulo: string;
  responsavelNome?: string;
}

export interface TaskCardProps {
  /** Item do grupo Task_Nova ou Task_Com_Acordo (ver src/api/types.ts). */
  item: TaskNovaItem | TaskComAcordoItem;
  /** Chamado após uma edição ser aceita pela API (Requisito 9.1, 9.2, 9.6, 9.7). */
  onTaskEditada?: (taskId: string, resultado: TaskEdicaoResultado) => void;
  /** Chamado após a remoção ser aceita pela API (Requisito 9.4, 9.5). */
  onTaskRemovida?: (taskId: string) => void;
  /**
   * Chamado após um registro ou avaliação de Acordo ser aceito pela API
   * (tarefa 28.1). Quando informado, o card exibe as ações "Registrar
   * Acordo" e (para Task_Com_Acordo) "Avaliar".
   */
  onAcordoAlterado?: () => void;
}

type StatusUsuarios = 'carregando' | 'sucesso' | 'erro';
type PainelAberto = 'nenhum' | 'registrar-acordo' | 'avaliar-acordo';

/** Type guard: distingue um item de Task_Com_Acordo de um item de Task_Nova. */
function isTaskComAcordoItem(
  item: TaskNovaItem | TaskComAcordoItem,
): item is TaskComAcordoItem {
  return 'tipoAcordoNome' in item;
}

/** Formata a data de registro do Acordo para exibição (locale pt-BR). */
function formatarDataRegistro(dataIso: string): string {
  const data = new Date(dataIso);
  if (Number.isNaN(data.getTime())) {
    return dataIso;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(data);
}

export function TaskCard({ item, onTaskEditada, onTaskRemovida, onAcordoAlterado }: TaskCardProps) {
  const comAcordo = isTaskComAcordoItem(item);
  const emAlerta = comAcordo && item.alerta;
  const emAlertaTentativasAvaliarPlanejar = comAcordo && item.alertaTentativasAvaliarPlanejar;

  const [editando, setEditando] = useState(false);
  const [usuarios, setUsuarios] = useState<UsuarioCadastrado[]>([]);
  const [statusUsuarios, setStatusUsuarios] = useState<StatusUsuarios>('carregando');

  const [titulo, setTitulo] = useState(item.titulo);
  const [responsavelId, setResponsavelId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);

  const [removendo, setRemovendo] = useState(false);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [erroRemocao, setErroRemocao] = useState<string | null>(null);

  const [painelAberto, setPainelAberto] = useState<PainelAberto>('nenhum');
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const [repetindo, setRepetindo] = useState(false);
  const [erroRepetir, setErroRepetir] = useState<string | null>(null);

  const [finalizando, setFinalizando] = useState(false);
  const [erroFinalizar, setErroFinalizar] = useState<string | null>(null);

  function handleRegistrado() {
    setPainelAberto('nenhum');
    onAcordoAlterado?.();
  }

  function handleAvaliado() {
    setPainelAberto('nenhum');
    onAcordoAlterado?.();
  }

  function handleRepetirUltimoAcordo() {
    if (repetindo) {
      return;
    }

    setErroRepetir(null);
    setRepetindo(true);

    repetirUltimoAcordo(item.id)
      .then(() => {
        onAcordoAlterado?.();
      })
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError ? error.message : 'Não foi possível repetir o Acordo.';
        setErroRepetir(mensagem);
      })
      .finally(() => {
        setRepetindo(false);
      });
  }

  function handleFinalizar() {
    if (finalizando) {
      return;
    }

    setErroFinalizar(null);
    setFinalizando(true);

    finalizarTask(item.id)
      .then(() => {
        onAcordoAlterado?.();
      })
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError ? error.message : 'Não foi possível finalizar a Task.';
        setErroFinalizar(mensagem);
      })
      .finally(() => {
        setFinalizando(false);
      });
  }

  function iniciarEdicao() {
    setTitulo(item.titulo);
    setErroEdicao(null);
    setStatusUsuarios('carregando');
    setEditando(true);

    listarUsuarios()
      .then((resultado) => {
        setUsuarios(resultado);
        // Nota de design: o item da lista só traz `responsavelNome`, não
        // `responsavelId` — resolve-se o Usuário atual comparando o nome
        // exibido com o `nomeLogin` cadastrado. Sem correspondência, o
        // select inicia sem seleção ("Nenhum").
        const usuarioAtual = item.responsavelNome
          ? resultado.find((usuario) => usuario.nomeLogin === item.responsavelNome)
          : undefined;
        setResponsavelId(usuarioAtual?.id ?? '');
        setStatusUsuarios('sucesso');
      })
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError ? error.message : 'Não foi possível carregar Usuários.';
        setErroEdicao(mensagem);
        setStatusUsuarios('erro');
      });
  }

  function cancelarEdicao() {
    if (enviando) {
      return;
    }
    setEditando(false);
    setErroEdicao(null);
  }

  function handleSalvarEdicao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (enviando) {
      return;
    }

    setErroEdicao(null);
    setEnviando(true);

    editarTask(item.id, { titulo, responsavelId: responsavelId === '' ? null : responsavelId })
      .then(() => {
        const usuarioSelecionado = usuarios.find((usuario) => usuario.id === responsavelId);
        setEditando(false);
        onTaskEditada?.(item.id, {
          titulo,
          responsavelNome: usuarioSelecionado?.nomeLogin,
        });
      })
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError ? error.message : 'Não foi possível editar a Task.';
        setErroEdicao(mensagem);
      })
      .finally(() => {
        setEnviando(false);
      });
  }

  function iniciarRemocao() {
    setErroRemocao(null);
    setConfirmandoRemocao(true);
  }

  function cancelarRemocao() {
    if (removendo) {
      return;
    }
    setConfirmandoRemocao(false);
    setErroRemocao(null);
  }

  function handleConfirmarRemocao() {
    if (removendo) {
      return;
    }

    setErroRemocao(null);
    setRemovendo(true);

    removerTask(item.id)
      .then(() => {
        onTaskRemovida?.(item.id);
      })
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError ? error.message : 'Não foi possível remover a Task.';
        setErroRemocao(mensagem);
      })
      .finally(() => {
        setRemovendo(false);
      });
  }

  if (editando) {
    const tituloInputId = `task-card-editar-titulo-${item.id}`;
    const responsavelInputId = `task-card-editar-responsavel-${item.id}`;

    return (
      <article className="task-card" data-testid="task-card">
        <form
          onSubmit={handleSalvarEdicao}
          className="task-card__editar-form"
          data-testid="task-card-editar-form"
        >
          <div className="task-card__campo">
            <label htmlFor={tituloInputId}>Título</label>
            <input
              id={tituloInputId}
              type="text"
              value={titulo}
              onChange={(event) => setTitulo(event.target.value)}
              disabled={enviando}
              data-testid="task-card-editar-titulo"
            />
          </div>

          <div className="task-card__campo">
            <label htmlFor={responsavelInputId}>Responsável</label>
            <select
              id={responsavelInputId}
              value={responsavelId}
              onChange={(event) => setResponsavelId(event.target.value)}
              disabled={enviando || statusUsuarios !== 'sucesso'}
              data-testid="task-card-editar-responsavel"
            >
              <option value="">Nenhum</option>
              {usuarios.map((usuario) => (
                <option key={usuario.id} value={usuario.id}>
                  {usuario.nomeLogin}
                </option>
              ))}
            </select>
          </div>

          <div className="task-card__editar-acoes">
            <button
              type="submit"
              disabled={enviando || statusUsuarios === 'carregando'}
              data-testid="task-card-salvar"
            >
              {enviando ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={cancelarEdicao}
              disabled={enviando}
              data-testid="task-card-cancelar"
            >
              Cancelar
            </button>
          </div>

          {erroEdicao && (
            <p role="alert" className="task-card__erro" data-testid="task-card-erro-edicao">
              {erroEdicao}
            </p>
          )}
        </form>
      </article>
    );
  }

  const emAlgumAlerta = emAlerta || emAlertaTentativasAvaliarPlanejar;

  return (
    <article
      className={emAlgumAlerta ? 'task-card task-card--alerta' : 'task-card'}
      aria-label={
        emAlerta
          ? `Task "${item.titulo}" em alerta: Acordo não cumprido`
          : emAlertaTentativasAvaliarPlanejar
            ? `Task "${item.titulo}" em alerta: número de tentativas de Avaliar e planejar alto`
            : `Task "${item.titulo}"`
      }
      data-testid="task-card"
    >
      <h3 className="task-card__titulo">{item.titulo}</h3>

      {item.responsavelNome && (
        <p className="task-card__responsavel">
          <span className="task-card__label">Responsável:</span> {item.responsavelNome}
        </p>
      )}

      {comAcordo && (
        <>
          <p className="task-card__tipo-acordo">
            <span className="task-card__label">Tipo de Acordo:</span> {item.tipoAcordoNome}
          </p>
          <p className="task-card__data-registro">
            <span className="task-card__label">Registrado em:</span>{' '}
            {formatarDataRegistro(item.dataRegistroAcordoAtual)}
          </p>

          {emAlerta && (
            <p className="task-card__alerta" role="status">
              <span className="task-card__alerta-badge" aria-hidden="true">
                ⚠
              </span>{' '}
              Alerta: Acordo não cumprido — Nº de tentativas: {item.numTentativas}
            </p>
          )}

          {emAlertaTentativasAvaliarPlanejar && (
            <p className="task-card__alerta" role="status">
              <span className="task-card__alerta-badge" aria-hidden="true">
                ⚠
              </span>{' '}
              Alerta: número de tentativas de "Avaliar e planejar" alto — Nº de tentativas:{' '}
              {item.tentativasAvaliarPlanejar}
            </p>
          )}
        </>
      )}

      <div className="task-card__acoes">
        {onTaskEditada && (
          <button type="button" onClick={iniciarEdicao} data-testid="task-card-editar">
            Editar
          </button>
        )}
        {onAcordoAlterado && (
          <button
            type="button"
            onClick={() =>
              setPainelAberto((atual) =>
                atual === 'registrar-acordo' ? 'nenhum' : 'registrar-acordo',
              )
            }
            data-testid="task-card-registrar-acordo"
          >
            Registrar Acordo
          </button>
        )}
        {onAcordoAlterado && comAcordo && (
          <button
            type="button"
            onClick={() =>
              setPainelAberto((atual) =>
                atual === 'avaliar-acordo' ? 'nenhum' : 'avaliar-acordo',
              )
            }
            data-testid="task-card-avaliar-acordo"
          >
            Avaliar
          </button>
        )}
        {onAcordoAlterado && comAcordo && (
          <button
            type="button"
            onClick={handleRepetirUltimoAcordo}
            disabled={repetindo}
            data-testid="task-card-repetir-ultimo-acordo"
          >
            {repetindo ? 'Repetindo...' : 'Repetir último acordo'}
          </button>
        )}
        {onAcordoAlterado && comAcordo && (
          <button
            type="button"
            onClick={handleFinalizar}
            disabled={finalizando}
            data-testid="task-card-finalizar"
          >
            {finalizando ? 'Finalizando...' : 'Finalizar'}
          </button>
        )}
        {onTaskRemovida && !confirmandoRemocao && (
          <button type="button" onClick={iniciarRemocao} data-testid="task-card-remover">
            Remover
          </button>
        )}
        {onTaskRemovida && confirmandoRemocao && (
          <span className="task-card__confirmar-remocao">
            Remover esta Task permanentemente?
            <button
              type="button"
              onClick={handleConfirmarRemocao}
              disabled={removendo}
              data-testid="task-card-confirmar-remocao"
            >
              {removendo ? 'Removendo...' : 'Confirmar'}
            </button>
            <button
              type="button"
              onClick={cancelarRemocao}
              disabled={removendo}
              data-testid="task-card-cancelar-remocao"
            >
              Cancelar
            </button>
          </span>
        )}
        <button
          type="button"
          className="task-card__botao-icone"
          onClick={() => setHistoricoAberto(true)}
          title="Ver histórico"
          aria-label="Ver histórico"
          data-testid="task-card-ver-historico"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
        </button>
      </div>

      {painelAberto === 'registrar-acordo' && (
        <div className="task-card__painel-acordo" data-testid="task-card-painel-registrar-acordo">
          <RegistrarAcordoForm taskId={item.id} onRegistrado={handleRegistrado} />
        </div>
      )}

      {painelAberto === 'avaliar-acordo' && comAcordo && (
        <div className="task-card__painel-acordo" data-testid="task-card-painel-avaliar-acordo">
          <AvaliarAcordoForm taskId={item.id} onAvaliado={handleAvaliado} />
        </div>
      )}

      {erroRemocao && (
        <p role="alert" className="task-card__erro" data-testid="task-card-erro-remocao">
          {erroRemocao}
        </p>
      )}

      {erroRepetir && (
        <p role="alert" className="task-card__erro" data-testid="task-card-erro-repetir">
          {erroRepetir}
        </p>
      )}

      {erroFinalizar && (
        <p role="alert" className="task-card__erro" data-testid="task-card-erro-finalizar">
          {erroFinalizar}
        </p>
      )}

      {historicoAberto && (
        <TaskHistoricoModal
          taskId={item.id}
          taskTitulo={item.titulo}
          onClose={() => setHistoricoAberto(false)}
        />
      )}
    </article>
  );
}

export default TaskCard;
