// AvaliarAcordoForm — formulário para avaliar o Acordo_Atual de uma Task
// como cumprido ou não cumprido (design.md > Frontend Components >
// AvaliarAcordoForm), submetendo para `PATCH /tasks/:id/acordos/atual`.
//
// Requisito 4.1/4.2: duas ações distintas — "marcar cumprido" e "marcar
// não cumprido" — já que o resultado é um de exatamente dois valores.
// Requisito 4.5/4.6: ao escolher "não cumprido", um select opcional de
// Motivo_de_Nao_Cumprimento é exibido; quando nenhum motivo é
// selecionado, o campo simplesmente não é enviado no corpo da
// requisição. Ao escolher "cumprido", nenhum motivo é necessário/enviado.
// Requisito 4.7: Motivo inválido é rejeitado pela API — o erro é exibido
// preservando a seleção atual do formulário (nada é limpo). O mesmo vale
// para o Requisito 4.8 (Task sem Acordo_Atual).

import { useEffect, useState, type FormEvent } from 'react';
import { avaliarAcordoAtual, listarMotivos } from '../api/client';
import { ApiError } from '../api/errors';
import type { Acordo, MotivoNaoCumprimento, ResultadoAvaliacao } from '../api/types';
import './AvaliarAcordoForm.css';

type StatusCarregamento = 'carregando' | 'sucesso' | 'erro';

export interface AvaliarAcordoFormProps {
  /** Id da Task cujo Acordo_Atual será avaliado. */
  taskId: string;
  /** Chamado com o Acordo avaliado após a avaliação ter sido aceita pela API. */
  onAvaliado: (acordo: Acordo) => void;
}

export function AvaliarAcordoForm({ taskId, onAvaliado }: AvaliarAcordoFormProps) {
  const [motivos, setMotivos] = useState<MotivoNaoCumprimento[]>([]);
  const [statusCarregamento, setStatusCarregamento] = useState<StatusCarregamento>('carregando');
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);

  const [acaoSelecionada, setAcaoSelecionada] = useState<ResultadoAvaliacao | null>(null);
  const [motivoId, setMotivoId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroSubmissao, setErroSubmissao] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    setStatusCarregamento('carregando');
    setErroCarregamento(null);

    listarMotivos()
      .then((resultado) => {
        if (cancelado) return;
        setMotivos(resultado);
        setStatusCarregamento('sucesso');
      })
      .catch((error: unknown) => {
        if (cancelado) return;
        const mensagem =
          error instanceof ApiError
            ? error.message
            : 'Não foi possível carregar Motivos de Não Cumprimento.';
        setErroCarregamento(mensagem);
        setStatusCarregamento('erro');
      });

    return () => {
      cancelado = true;
    };
  }, [taskId]);

  function submeter(resultado: ResultadoAvaliacao) {
    if (enviando) {
      return;
    }

    setErroSubmissao(null);
    setEnviando(true);

    avaliarAcordoAtual(taskId, {
      resultado,
      ...(resultado === 'nao_cumprido' && motivoId ? { motivoId } : {}),
    })
      .then((acordo) => {
        setAcaoSelecionada(null);
        setMotivoId('');
        onAvaliado(acordo);
      })
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError ? error.message : 'Não foi possível avaliar o Acordo.';
        setErroSubmissao(mensagem);
      })
      .finally(() => {
        setEnviando(false);
      });
  }

  function handleMarcarCumprido() {
    setErroSubmissao(null);
    setAcaoSelecionada('cumprido');
    submeter('cumprido');
  }

  function handleMarcarNaoCumprido() {
    setErroSubmissao(null);
    setAcaoSelecionada('nao_cumprido');
  }

  function handleCancelarNaoCumprido() {
    if (enviando) {
      return;
    }
    setErroSubmissao(null);
    setAcaoSelecionada(null);
    setMotivoId('');
  }

  function handleConfirmarNaoCumprido(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submeter('nao_cumprido');
  }

  if (statusCarregamento === 'carregando') {
    return (
      <p role="status" data-testid="avaliar-acordo-form-carregando">
        Carregando Motivos de Não Cumprimento...
      </p>
    );
  }

  if (statusCarregamento === 'erro') {
    return (
      <p
        role="alert"
        className="avaliar-acordo-form__erro"
        data-testid="avaliar-acordo-form-erro-carregamento"
      >
        {erroCarregamento}
      </p>
    );
  }

  const motivoInputId = `avaliar-acordo-form-motivo-${taskId}`;

  return (
    <div className="avaliar-acordo-form" data-testid="avaliar-acordo-form">
      <div className="avaliar-acordo-form__acoes">
        <button
          type="button"
          disabled={enviando}
          onClick={handleMarcarCumprido}
          data-testid="avaliar-acordo-form-cumprido"
        >
          {enviando && acaoSelecionada === 'cumprido' ? 'Avaliando...' : 'Marcar cumprido'}
        </button>
        <button
          type="button"
          disabled={enviando}
          onClick={handleMarcarNaoCumprido}
          data-testid="avaliar-acordo-form-nao-cumprido"
        >
          Marcar não cumprido
        </button>
      </div>

      {acaoSelecionada === 'nao_cumprido' && (
        <form
          onSubmit={handleConfirmarNaoCumprido}
          className="avaliar-acordo-form__motivo"
          data-testid="avaliar-acordo-form-motivo-form"
        >
          <div className="avaliar-acordo-form__campo">
            <label htmlFor={motivoInputId}>Motivo de Não Cumprimento (opcional)</label>
            <select
              id={motivoInputId}
              value={motivoId}
              onChange={(event) => setMotivoId(event.target.value)}
              disabled={enviando}
              data-testid="avaliar-acordo-form-motivo-select"
            >
              <option value="">Nenhum</option>
              {motivos.map((motivo) => (
                <option key={motivo.id} value={motivo.id}>
                  {motivo.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="avaliar-acordo-form__motivo-acoes">
            <button
              type="submit"
              disabled={enviando}
              data-testid="avaliar-acordo-form-confirmar-nao-cumprido"
            >
              {enviando ? 'Avaliando...' : 'Confirmar não cumprido'}
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={handleCancelarNaoCumprido}
              data-testid="avaliar-acordo-form-cancelar-nao-cumprido"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {erroSubmissao && (
        <p
          role="alert"
          className="avaliar-acordo-form__erro"
          data-testid="avaliar-acordo-form-erro-submissao"
        >
          {erroSubmissao}
        </p>
      )}
    </div>
  );
}

export default AvaliarAcordoForm;
