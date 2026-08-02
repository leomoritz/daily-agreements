// MotivoModal — implementa o Modal_de_Motivo (design.md > Frontend
// Components > MotivoModal), reutilizado tanto pela Acao_Marcar_Nao_Cumprido
// (Requisito 3) quanto pela Acao_Repetir_Ultimo_Acordo (Requisito 4).
//
// Requisito 3.1: abre com o Combobox_de_Motivo sem seleção e sem texto,
// exceto quando `motivoInicial` é informado — nesse caso (Ultimo_Motivo_
// Informado da Task, reutilizado tanto por "Marcar como não cumprido"
// quanto por "Repetir último acordo"), o Combobox_de_Motivo abre
// pré-preenchido com esse valor, que o usuário pode editar livremente
// antes de confirmar.
// Requisito 3.2/4.1: o Combobox_de_Motivo é um único `<input list="...">`
// com `<datalist>` alimentado por `listarMotivos()`, permitindo digitar um
// nome novo mesmo quando o Cadastro_de_Motivos_de_Nao_Cumprimento está
// vazio ou falha ao carregar — a falha de carregamento não bloqueia o
// modal (o cadastro simplesmente não populariza a datalist).
// Requisito 3.7/4.7: cancelar (botão ou `Esc`) apenas fecha o modal, sem
// submeter nada.
// Requisito 3.8/3.9/4.8: em rejeição da API (validação, erro de negócio ou
// timeout — já traduzido em `ApiError` pelo fetch wrapper), o modal
// permanece aberto, exibe a mensagem de erro e preserva o texto digitado.
// Requisito 3.10/4.10: enquanto a confirmação está pendente, as ações de
// confirmar e cancelar ficam indisponíveis, garantindo no máximo uma
// submissão por confirmação.
// Requisito 10.4: erro de rejeição preserva o valor do Combobox_de_Motivo,
// exibindo a mensagem retornada pela API dentro do próprio modal.
//
// O componente não chama nenhuma API que mute um Acordo: apenas coleta
// `motivoNome` (sem trim no cliente — trim e resolução case-insensitive
// são do backend) e delega a operação a `onConfirmar`, permitindo
// reutilização tanto para "Marcar como não cumprido" quanto para
// "Repetir último acordo".

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { listarMotivos } from '../api/client';
import { ApiError } from '../api/errors';
import type { MotivoNaoCumprimento } from '../api/types';
import './MotivoModal.css';

export interface MotivoModalProps {
  /** Título exibido no cabeçalho do modal. */
  titulo: string;
  /**
   * Valor inicial do Combobox_de_Motivo (ex.: o Ultimo_Motivo_Informado
   * da Task), permitindo reutilizar o último motivo sem redigitá-lo. O
   * usuário ainda pode alterá-lo livremente antes de confirmar.
   */
  motivoInicial?: string;
  /** Chamado ao confirmar, com o texto corrente do Combobox_de_Motivo (sem trim). */
  onConfirmar: (motivoNome: string) => Promise<void>;
  /** Chamado ao cancelar (botão de cancelamento, `Esc` ou fechamento do modal). */
  onCancelar: () => void;
}

export function MotivoModal({ titulo, motivoInicial, onConfirmar, onCancelar }: MotivoModalProps) {
  const [motivos, setMotivos] = useState<MotivoNaoCumprimento[]>([]);
  const [motivoNome, setMotivoNome] = useState(motivoInicial ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erroSubmissao, setErroSubmissao] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const datalistId = useId();

  // Carrega o Cadastro_de_Motivos_de_Nao_Cumprimento para a datalist. Uma
  // falha de carregamento não bloqueia o modal: o Combobox_de_Motivo
  // continua aceitando digitação de nome novo (Requisito 3.2).
  useEffect(() => {
    let cancelado = false;

    listarMotivos()
      .then((resultado) => {
        if (cancelado) return;
        setMotivos(resultado);
      })
      .catch(() => {
        // Sem tratamento de erro dedicado: a datalist fica vazia e o
        // Usuário ainda pode digitar um nome novo.
      });

    return () => {
      cancelado = true;
    };
  }, []);

  // Foco inicial no Combobox_de_Motivo (Requisito 3.1, design.md).
  useEffect(() => {    
    inputRef.current?.focus();
  }, []);

  function handleCancelar() {
    if (enviando) {
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

  function handleConfirmar() {
    if (enviando) {
      return;
    }

    setErroSubmissao(null);
    setEnviando(true);

    onConfirmar(motivoNome)
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError ? error.message : 'Não foi possível confirmar o motivo.';
        setErroSubmissao(mensagem);
      })
      .finally(() => {
        setEnviando(false);
      });
  }

  return (
    <div
      className="motivo-modal__overlay"
      onKeyDown={handleKeyDown}
      data-testid="motivo-modal-overlay"
    >
      <div
        className="motivo-modal"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        data-testid="motivo-modal"
      >
        <h2 className="motivo-modal__titulo">{titulo}</h2>

        <div className="motivo-modal__campo">
          <label htmlFor={datalistId}>Motivo de Não Cumprimento</label>
          <input
            ref={inputRef}
            id={datalistId}
            type="text"
            list={`${datalistId}-lista`}
            placeholder="Digite ou selecione um motivo"
            value={motivoNome}
            onChange={(event) => setMotivoNome(event.target.value)}
            disabled={enviando}
            data-testid="motivo-modal-combobox"
          />
          <datalist id={`${datalistId}-lista`} data-testid="motivo-modal-datalist">
            {motivos.map((motivo) => (
              <option key={motivo.id} value={motivo.nome} />
            ))}
          </datalist>
        </div>

        <div className="motivo-modal__acoes">
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={enviando}
            data-testid="motivo-modal-confirmar"
          >
            {enviando ? 'Confirmando...' : 'Confirmar'}
          </button>
          <button
            type="button"
            onClick={handleCancelar}
            disabled={enviando}
            data-testid="motivo-modal-cancelar"
          >
            Cancelar
          </button>
        </div>

        {erroSubmissao && (
          <p role="alert" className="motivo-modal__erro" data-testid="motivo-modal-erro">
            {erroSubmissao}
          </p>
        )}
      </div>
    </div>
  );
}

export default MotivoModal;
