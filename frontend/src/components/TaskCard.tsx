// TaskCard — exibe uma Task na Lista_de_Acordos (design.md > Frontend
// Components > TaskCard). Recebe um item do grupo `taskNova[]` ou
// `taskComAcordo[]` retornado por `GET /tasks` (ver src/api/types.ts) e
// renderiza os campos aplicáveis a cada grupo.
//
// Requisito 3.1 (spec base) / 1.1, 1.2, 1.7, 2.1, 2.2, 2.7: para
// Task_Com_Acordo, exibe título, Tipo_de_Acordo, Responsável (quando
// houver) e, na ordem exigida, "Registrado em" → Campo_Numero_de_Tentativas
// (sempre, inclusive zero) → Campo_Ultimo_Motivo (omitido, com o rótulo,
// quando a Task não possui Ultimo_Motivo_Informado). Requisito 3.3 (spec
// base): para Task_Nova, exibe título e Responsável (quando houver), sem
// Campo_Numero_de_Tentativas nem Campo_Ultimo_Motivo.
// Requisito 1.4, 1.5, 1.6: os textos de alerta ("Alerta: Acordo não
// cumprido" e "Alerta: número de tentativas de 'Avaliar e planejar'
// alto") não contêm nenhum contador — o Campo_Numero_de_Tentativas é a
// única origem do valor do Nº_Tentativas.
//
// Requisito 9.1/9.2/9.6/9.7 (edição de título/Responsável): quando
// `onTaskEditada` é informado, um botão "Editar" alterna o card para um
// modo de edição com um campo de texto (título) e um select de
// Responsável (carregado via `listarUsuarios()`), submetendo para
// `PATCH /tasks/:id`. O Responsável atual é pré-selecionado pelo
// `responsavelId` do item (Requisito 9.6) — não mais por correspondência
// de `responsavelNome` com `nomeLogin` — deixando o campo sem seleção
// quando esse id não pertence ao Cadastro_de_Usuários. Erros de
// validação (título vazio, Responsável inválido) são exibidos dentro do
// próprio formulário de edição sem descartar o que o usuário
// digitou/selecionou, permitindo corrigir e tentar novamente. O
// resultado da edição é comunicado ao chamador (`onTaskEditada`) como
// `{ titulo, responsavelNome }`, já resolvido a partir do Usuário
// selecionado.
//
// Requisito 9.4/9.5 (remoção manual): o botão "Remover" exige uma
// confirmação explícita antes de chamar `DELETE /tasks/:id`; erros são
// exibidos inline.
//
// Ações do card, quando `onAcordoAlterado` é informado:
// - "Registrar Acordo": abre `RegistrarAcordoForm` inline, recebendo
//   `estadoCumprimentoAcordoAtual` e `responsavelIdAtual` do item
//   (Requisitos 8.1–8.4, 9.1, 9.4, 9.6, 9.7). Exibida para toda Task.
// - "Marcar como não cumprido" (Acao_Marcar_Nao_Cumprido, Requisito 3):
//   abre o `MotivoModal` e, ao confirmar, submete
//   `PATCH /tasks/:id/acordos/atual` com `resultado: 'nao_cumprido'` e o
//   `motivoNome` informado. Exibida somente para Task_Com_Acordo,
//   permanecendo visível porém desabilitada (`disabled` + `aria-disabled`
//   + `title`) quando `tipoAcordoNome === 'Avaliar e planejar'`
//   (Requisitos 5.1, 5.4, 5.6) — nesse caso nenhum clique abre o modal ou
//   dispara requisição. O botão "Avaliar" (e o `AvaliarAcordoForm`) não
//   existe mais (Requisito 8.6): a avaliação de cumprimento passa a
//   ocorrer via Registro_de_Acordo_com_Avaliacao, "Repetir último
//   acordo", "Finalizar" ou esta ação.
// - "Repetir último acordo" (Acao_Repetir_Ultimo_Acordo, Requisito 4):
//   decide localmente se abre o `MotivoModal` — abre quando
//   `tipoAcordoNome !== 'Avaliar e planejar'` ou quando
//   `tentativasAvaliarPlanejar >= 2` (Requisitos 4.1, 4.3, 4.4); caso
//   contrário chama `POST /tasks/:id/acordos/repetir` diretamente, sem
//   modal. Exibida somente para Task_Com_Acordo.
// - "Ver histórico": abre `TaskHistoricoModal` (Requisito 7 da spec
//   base). Exibida para toda Task, independente de `onAcordoAlterado`.
// - "Finalizar": chama diretamente `POST /tasks/:id/finalizar`. Exibida
//   somente para Task_Com_Acordo.
//
// Requisito 3.10/4.10/10.11: um único estado `operacaoEmAndamento`
// desabilita todas as ações de Acordo do card (Registrar Acordo, Marcar
// como não cumprido, Repetir último acordo, Finalizar) enquanto qualquer
// uma dessas operações está pendente, garantindo no máximo uma submissão
// por vez. Após sucesso, o painel/modal correspondente é fechado e
// `onAcordoAlterado` é chamado para que a página recarregue a lista
// completa do servidor (Requisitos 3.3, 4.11, 8.8, 10.3) — mais simples e
// correto do que reclassificar/atualizar o item localmente, já que o
// backend já calcula tudo isso em `ListaDeAcordosService`.

import { useState, type FormEvent } from 'react';
import {
  avaliarAcordoAtual,
  editarTask,
  finalizarTask,
  listarUsuarios,
  removerTask,
  repetirUltimoAcordo,
} from '../api/client';
import { ApiError } from '../api/errors';
import type { TaskComAcordoItem, TaskNovaItem, UsuarioCadastrado } from '../api/types';
import { MotivoModal } from './MotivoModal';
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
   * Chamado após um registro, avaliação ou repetição de Acordo ser
   * aceito pela API. Quando informado, o card exibe as ações "Registrar
   * Acordo" e, para Task_Com_Acordo, "Marcar como não cumprido",
   * "Repetir último acordo" e "Finalizar".
   */
  onAcordoAlterado?: () => void;
}

type StatusUsuarios = 'carregando' | 'sucesso' | 'erro';
type PainelAberto = 'nenhum' | 'registrar-acordo';
type ModalAberto = 'nenhum' | 'marcar-nao-cumprido' | 'repetir-ultimo-acordo';

const TIPO_ACORDO_AVALIAR_PLANEJAR = 'Avaliar e planejar';

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
  const [modalAberto, setModalAberto] = useState<ModalAberto>('nenhum');
  const [historicoAberto, setHistoricoAberto] = useState(false);

  // Requisitos 3.10, 4.10, 10.11: um único estado desabilita todas as
  // ações de Acordo do card enquanto qualquer uma delas está pendente,
  // garantindo no máximo uma submissão por vez. Cada ação mantém sua
  // própria mensagem de erro.
  const [operacaoEmAndamento, setOperacaoEmAndamento] = useState(false);
  const [erroRepetir, setErroRepetir] = useState<string | null>(null);
  const [erroFinalizar, setErroFinalizar] = useState<string | null>(null);

  const tipoAcordoAtual = comAcordo ? item.tipoAcordoNome : undefined;
  const acaoMarcarNaoCumpridoDesabilitada = tipoAcordoAtual === TIPO_ACORDO_AVALIAR_PLANEJAR;

  function handleRegistrado() {
    setPainelAberto('nenhum');
    onAcordoAlterado?.();
  }

  function handleAbrirMarcarNaoCumprido() {
    if (operacaoEmAndamento || acaoMarcarNaoCumpridoDesabilitada) {
      return;
    }
    setModalAberto('marcar-nao-cumprido');
  }

  async function handleConfirmarMarcarNaoCumprido(motivoNome: string) {
    setOperacaoEmAndamento(true);
    try {
      await avaliarAcordoAtual(item.id, {
        resultado: 'nao_cumprido',
        ...(motivoNome ? { motivoNome } : {}),
      });
      setModalAberto('nenhum');
      onAcordoAlterado?.();
    } finally {
      setOperacaoEmAndamento(false);
    }
  }

  function handleRepetirUltimoAcordo() {
    if (operacaoEmAndamento) {
      return;
    }

    // Requisitos 4.1, 4.3, 4.4: abre o Modal_de_Motivo quando o
    // Tipo_de_Acordo do Acordo_Atual é diferente de "Avaliar e
    // planejar", ou quando é "Avaliar e planejar" com
    // `tentativasAvaliarPlanejar >= 2` (3ª repetição consecutiva ou
    // posterior); nos demais casos, chama a API diretamente.
    const exigeModal =
    comAcordo &&
      (item.tipoAcordoNome !== TIPO_ACORDO_AVALIAR_PLANEJAR || item.tentativasAvaliarPlanejar >= 2);

    if (exigeModal) {
      setErroRepetir(null);
      setModalAberto('repetir-ultimo-acordo');
      return;
    }

    setErroRepetir(null);
    setOperacaoEmAndamento(true);

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
        setOperacaoEmAndamento(false);
      });
  }

  async function handleConfirmarRepetirUltimoAcordo(motivoNome: string) {
    setOperacaoEmAndamento(true);
    try {
      await repetirUltimoAcordo(item.id, motivoNome ? { motivoNome } : undefined);
      setModalAberto('nenhum');
      onAcordoAlterado?.();
    } finally {
      setOperacaoEmAndamento(false);
    }
  }

  function handleCancelarModal() {
    setModalAberto('nenhum');
  }

  function handleFinalizar() {
    if (operacaoEmAndamento) {
      return;
    }

    setErroFinalizar(null);
    setOperacaoEmAndamento(true);

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
        setOperacaoEmAndamento(false);
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
        // Requisito 9.6: o Responsável atual é pré-selecionado pelo
        // `responsavelId` do item — não mais por correspondência de
        // `responsavelNome` com `nomeLogin`. Sem correspondência (id
        // ausente ou não pertencente ao Cadastro_de_Usuários), o select
        // inicia sem seleção ("Nenhum").
        const usuarioAtual = item.responsavelId
          ? resultado.find((usuario) => usuario.id === item.responsavelId)
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
          {/* Ordem exigida pelos Requisitos 1.1, 1.2, 1.7, 2.1, 2.2, 2.7:
              "Registrado em" → Nº de tentativas (sempre) → Último motivo
              informado (omitido, com o rótulo, quando ausente). */}
          <p className="task-card__data-registro">
            <span className="task-card__label">Registrado em:</span>{' '}
            {formatarDataRegistro(item.dataRegistroAcordoAtual)}
          </p>
          <p className="task-card__num-tentativas" data-testid="task-card-num-tentativas">
            <span className="task-card__label">Nº de tentativas:</span> {item.numTentativas}
          </p>
          {item.ultimoMotivoNome && (
            <p className="task-card__ultimo-motivo" data-testid="task-card-ultimo-motivo">
              <span className="task-card__label">Último motivo informado:</span>{' '}
              {item.ultimoMotivoNome}
            </p>
          )}

          {emAlerta && (
            <p className="task-card__alerta" role="status">
              <span className="task-card__alerta-badge" aria-hidden="true">
                ⚠
              </span>{' '}
              Alerta: Acordo não cumprido
            </p>
          )}

          {emAlertaTentativasAvaliarPlanejar && (
            <p className="task-card__alerta" role="status">
              <span className="task-card__alerta-badge" aria-hidden="true">
                ⚠
              </span>{' '}
              Alerta: número de tentativas de "Avaliar e planejar" alto
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
            disabled={operacaoEmAndamento}
            data-testid="task-card-registrar-acordo"
          >
            Registrar acordo
          </button>
        )}
        {onAcordoAlterado && comAcordo && (
          <button
            type="button"
            onClick={handleAbrirMarcarNaoCumprido}
            disabled={operacaoEmAndamento || acaoMarcarNaoCumpridoDesabilitada}
            aria-disabled={acaoMarcarNaoCumpridoDesabilitada}
            title={
              acaoMarcarNaoCumpridoDesabilitada
                ? 'Acordos de "Avaliar e planejar" são avaliados apenas por repetição ou finalização.'
                : undefined
            }
            data-testid="task-card-marcar-nao-cumprido"
          >
            Registrar não cumprido
          </button>
        )}
        {onAcordoAlterado && comAcordo && (
          <button
            type="button"
            onClick={handleRepetirUltimoAcordo}
            disabled={operacaoEmAndamento}
            data-testid="task-card-repetir-ultimo-acordo"
          >
            {operacaoEmAndamento ? 'Processando...' : 'Repetir último acordo'}
          </button>
        )}
        {onAcordoAlterado && comAcordo && (
          <button
            type="button"
            onClick={handleFinalizar}
            disabled={operacaoEmAndamento}
            data-testid="task-card-finalizar"
          >
            {operacaoEmAndamento ? 'Processando...' : 'Finalizar'}
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
          <RegistrarAcordoForm
            taskId={item.id}
            comAcordo={comAcordo}
            estadoCumprimentoAcordoAtual={comAcordo ? item.estadoCumprimentoAcordoAtual : undefined}
            responsavelIdAtual={item.responsavelId}
            onRegistrado={handleRegistrado}
          />
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

      {modalAberto === 'marcar-nao-cumprido' && (
        <MotivoModal
          titulo="Marcar como não cumprido"
          onConfirmar={handleConfirmarMarcarNaoCumprido}
          onCancelar={handleCancelarModal}
        />
      )}

      {modalAberto === 'repetir-ultimo-acordo' && (
        <MotivoModal
          titulo="Repetir último acordo"
          onConfirmar={handleConfirmarRepetirUltimoAcordo}
          onCancelar={handleCancelarModal}
        />
      )}
    </article>
  );
}

export default TaskCard;
