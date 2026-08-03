// TaskHistoricoModal — modal que exibe o histórico completo de Acordos de
// uma Task (design.md > Frontend Components > TaskHistoricoModal),
// consumindo `GET /tasks/:id/historico`.
//
// Requisito 7.1: lista todos os Acordos da Task, do mais antigo ao mais
// recente — a própria API já retorna a lista ordenada por `dataRegistro`
// ascendente (ver backend/src/services/taskService.ts >
// `buscarHistorico`), então o modal apenas renderiza na ordem recebida.
// Requisito 7.2: cada item exibe Responsável quando houver, Tipo_de_Acordo,
// data de registro e estado de cumprimento. Como as referências do Acordo
// não trazem os nomes resolvidos, o modal carrega os respectivos cadastros
// e resolve os nomes localmente.
// Requisito 7.4: histórico vazio exibe uma indicação, em vez de uma
// lista vazia.

import { useEffect, useState } from 'react';
import { buscarHistorico, listarTiposDeAcordo, listarUsuarios } from '../api/client';
import { ApiError } from '../api/errors';
import type {
  Acordo,
  EstadoCumprimento,
  TipoAcordo,
  UsuarioCadastrado,
} from '../api/types';
import './TaskHistoricoModal.css';

type StatusCarregamento = 'carregando' | 'sucesso' | 'erro';

export interface TaskHistoricoModalProps {
  /** Id da Task cujo histórico será exibido. */
  taskId: string;
  /** Título da Task, usado no cabeçalho do modal (opcional). */
  taskTitulo?: string;
  /** Chamado quando o usuário solicita o fechamento do modal. */
  onClose: () => void;
}

const LABEL_ESTADO_CUMPRIMENTO: Record<EstadoCumprimento, string> = {
  pendente: 'Pendente',
  cumprido: 'Cumprido',
  nao_cumprido: 'Não cumprido',
};

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

export function TaskHistoricoModal({ taskId, taskTitulo, onClose }: TaskHistoricoModalProps) {
  const [historico, setHistorico] = useState<Acordo[]>([]);
  const [tiposDeAcordo, setTiposDeAcordo] = useState<TipoAcordo[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioCadastrado[]>([]);
  const [statusCarregamento, setStatusCarregamento] = useState<StatusCarregamento>('carregando');
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    setStatusCarregamento('carregando');
    setErroCarregamento(null);

    Promise.all([buscarHistorico(taskId), listarTiposDeAcordo(), listarUsuarios()])
      .then(([resultadoHistorico, resultadoTipos, resultadoUsuarios]) => {
        if (cancelado) return;
        setHistorico(resultadoHistorico);
        setTiposDeAcordo(resultadoTipos);
        setUsuarios(resultadoUsuarios);
        setStatusCarregamento('sucesso');
      })
      .catch((error: unknown) => {
        if (cancelado) return;
        const mensagem =
          error instanceof ApiError ? error.message : 'Não foi possível carregar o histórico.';
        setErroCarregamento(mensagem);
        setStatusCarregamento('erro');
      });

    return () => {
      cancelado = true;
    };
  }, [taskId]);

  function nomeDoTipoDeAcordo(tipoAcordoId: string): string {
    const tipo = tiposDeAcordo.find((candidato) => candidato.id === tipoAcordoId);
    return tipo ? tipo.nome : tipoAcordoId;
  }

  function nomeDoResponsavel(responsavelId: string): string {
    const responsavel = usuarios.find((candidato) => candidato.id === responsavelId);
    return responsavel ? responsavel.nomeLogin : responsavelId;
  }

  const tituloModal = taskTitulo
    ? `Histórico de Acordos — ${taskTitulo}`
    : 'Histórico de Acordos';

  return (
    <div className="task-historico-modal__overlay" data-testid="task-historico-modal-overlay">
      <div
        className="task-historico-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tituloModal}
        data-testid="task-historico-modal"
      >
        <div className="task-historico-modal__cabecalho">
          <h2 className="task-historico-modal__titulo">{tituloModal}</h2>
          <button
            type="button"
            onClick={onClose}
            className="task-historico-modal__fechar"
            aria-label="Fechar histórico"
            data-testid="task-historico-modal-fechar"
          >
            ×
          </button>
        </div>

        {statusCarregamento === 'carregando' && (
          <p role="status" data-testid="task-historico-modal-carregando">
            Carregando histórico...
          </p>
        )}

        {statusCarregamento === 'erro' && (
          <p
            role="alert"
            className="task-historico-modal__erro"
            data-testid="task-historico-modal-erro"
          >
            {erroCarregamento}
          </p>
        )}

        {statusCarregamento === 'sucesso' && historico.length === 0 && (
          <p data-testid="task-historico-modal-vazio">Nenhum Acordo registrado.</p>
        )}

        {statusCarregamento === 'sucesso' && historico.length > 0 && (
          <ul className="task-historico-modal__lista" data-testid="task-historico-modal-lista">
            {historico.map((acordo) => (
              <li
                key={acordo.id}
                className="task-historico-modal__item"
                data-testid="task-historico-modal-item"
              >
                {acordo.responsavelId && (
                  <p className="task-historico-modal__responsavel">
                    <span className="task-historico-modal__label">Responsável:</span>{' '}
                    {nomeDoResponsavel(acordo.responsavelId)}
                  </p>
                )}
                <p className="task-historico-modal__tipo-acordo">
                  <span className="task-historico-modal__label">Tipo de Acordo:</span>{' '}
                  {nomeDoTipoDeAcordo(acordo.tipoAcordoId)}
                </p>
                <p className="task-historico-modal__data-registro">
                  <span className="task-historico-modal__label">Registrado em:</span>{' '}
                  {formatarDataRegistro(acordo.dataRegistro)}
                </p>
                <p className="task-historico-modal__estado">
                  <span className="task-historico-modal__label">Estado:</span>{' '}
                  {LABEL_ESTADO_CUMPRIMENTO[acordo.estadoCumprimento]}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TaskHistoricoModal;
