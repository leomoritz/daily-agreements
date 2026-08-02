// ConfirmacaoModal — modal genérico de confirmação (sim/não), usado pelo
// Card_de_Task para confirmar a remoção de uma Task (Requisito 9.4, 9.5)
// antes de chamar `DELETE /tasks/:id`. Segue o mesmo padrão de overlay e
// `role="dialog"` do MotivoModal/TaskHistoricoModal.
//
// Cancelar (botão ou `Esc`) apenas fecha o modal, sem submeter nada.
// Enquanto a confirmação está pendente (`confirmando`), os botões de
// confirmar e cancelar ficam desabilitados, evitando múltiplas
// submissões. Em caso de erro, a mensagem é exibida dentro do próprio
// modal e ele permanece aberto.

import { useEffect, type KeyboardEvent } from 'react';
import './ConfirmacaoModal.css';

export interface ConfirmacaoModalProps {
  /** Título exibido no cabeçalho do modal. */
  titulo: string;
  /** Mensagem de confirmação exibida no corpo do modal. */
  mensagem: string;
  /** Texto do botão de confirmação (padrão: "Confirmar"). */
  confirmarLabel?: string;
  /** Texto exibido no botão de confirmação enquanto `confirmando` é true. */
  confirmandoLabel?: string;
  /** Texto do botão de cancelamento (padrão: "Cancelar"). */
  cancelarLabel?: string;
  /** Indica que a confirmação está em andamento, desabilitando as ações. */
  confirmando?: boolean;
  /** Mensagem de erro a exibir, quando a última confirmação foi rejeitada. */
  erro?: string | null;
  /** Chamado ao confirmar a ação. */
  onConfirmar: () => void;
  /** Chamado ao cancelar (botão, `Esc` ou fechamento do modal). */
  onCancelar: () => void;
  /** `data-testid` do botão de confirmação (padrão: "confirmacao-modal-confirmar"). */
  testIdConfirmar?: string;
  /** `data-testid` do botão de cancelamento (padrão: "confirmacao-modal-cancelar"). */
  testIdCancelar?: string;
}

export function ConfirmacaoModal({
  titulo,
  mensagem,
  confirmarLabel = 'Confirmar',
  confirmandoLabel = 'Confirmando...',
  cancelarLabel = 'Cancelar',
  confirmando = false,
  erro,
  onConfirmar,
  onCancelar,
  testIdConfirmar = 'confirmacao-modal-confirmar',
  testIdCancelar = 'confirmacao-modal-cancelar',
}: ConfirmacaoModalProps) {
  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !confirmando) {
        onCancelar();
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [confirmando, onCancelar]);

  function handleCancelar() {
    if (confirmando) {
      return;
    }
    onCancelar();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelar();
    }
  }

  return (
    <div
      className="confirmacao-modal__overlay"
      onKeyDown={handleKeyDown}
      data-testid="confirmacao-modal-overlay"
    >
      <div
        className="confirmacao-modal"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        data-testid="confirmacao-modal"
      >
        <h2 className="confirmacao-modal__titulo">{titulo}</h2>

        <p className="confirmacao-modal__mensagem">{mensagem}</p>

        <div className="confirmacao-modal__acoes">
          <button
            type="button"
            onClick={onConfirmar}
            disabled={confirmando}
            data-testid={testIdConfirmar}
          >
            {confirmando ? confirmandoLabel : confirmarLabel}
          </button>
          <button
            type="button"
            onClick={handleCancelar}
            disabled={confirmando}
            data-testid={testIdCancelar}
          >
            {cancelarLabel}
          </button>
        </div>

        {erro && (
          <p role="alert" className="confirmacao-modal__erro" data-testid="confirmacao-modal-erro">
            {erro}
          </p>
        )}
      </div>
    </div>
  );
}

export default ConfirmacaoModal;
