// CadastroEmLotePanel — permite colar múltiplas linhas (uma Task por
// linha, opcionalmente "título;Tipo_de_Acordo") e submeter para
// `POST /tasks/lote` (design.md > Frontend Components > CadastroEmLotePanel).
//
// Requisito 12.1: textarea aceita múltiplas linhas, cada uma
// interpretada como "título" ou "título;Tipo_de_Acordo".
// Requisito 12.5: após o processamento, exibe um relatório por linha
// indicando se foi aceita ou rejeitada.
// Requisito 12.6: quando rejeitada, o relatório exibe o motivo da
// rejeição (`motivoMensagem`).
//
// O processamento em si (parsing, validação linha a linha, isolamento de
// erros) é responsabilidade do backend (`CadastroEmLoteService`); este
// componente apenas envia o texto e apresenta o relatório retornado.
//
// Wiring final do frontend (tarefa 28.1): quando `onProcessado` é
// informado, é chamado após cada processamento aceito pela API (mesmo
// quando todas as linhas foram rejeitadas — o relatório já comunica
// isso), permitindo que a página que hospeda este painel (ex.:
// `ListaDeAcordosPage`) recarregue a lista para exibir as Tasks recém
// criadas.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { processarLote } from '../api/client';
import { ApiError } from '../api/errors';
import type { ResultadoLinhaLote } from '../api/types';
import './CadastroEmLotePanel.css';

type Status = 'idle' | 'enviando' | 'sucesso' | 'erro';

export interface CadastroEmLotePanelProps {
  /** Chamado após um processamento ser aceito pela API (tarefa 28.1). */
  onProcessado?: (resultado: ResultadoLinhaLote[]) => void;
}

export function CadastroEmLotePanel({ onProcessado }: CadastroEmLotePanelProps = {}) {
  const [texto, setTexto] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [resultado, setResultado] = useState<ResultadoLinhaLote[] | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  const enviando = status === 'enviando';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (enviando) {
      return;
    }

    setStatus('enviando');
    setMensagemErro(null);

    processarLote(texto)
      .then((linhas) => {
        setResultado(linhas);
        setStatus('sucesso');
        onProcessado?.(linhas);
      })
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError
            ? error.message
            : 'Não foi possível processar o cadastro em lote.';
        setMensagemErro(mensagem);
        setResultado(null);
        setStatus('erro');
      });
  }

  return (
    <section className="cadastro-em-lote-panel" aria-labelledby="cadastro-em-lote-titulo">
      <h2 id="cadastro-em-lote-titulo">Cadastro em Lote</h2>
      <p className="cadastro-em-lote-panel__instrucoes">
        Cole uma Task por linha. Opcionalmente informe o Tipo_de_Acordo separado por
        &quot;;&quot; (ex.: <code>Revisar contrato;Enviar para code review</code>).
      </p>

      <form onSubmit={handleSubmit} className="cadastro-em-lote-panel__form">
        <label htmlFor="cadastro-em-lote-textarea" className="cadastro-em-lote-panel__label">
          Tasks a cadastrar
        </label>
        <textarea
          id="cadastro-em-lote-textarea"
          className="cadastro-em-lote-panel__textarea"
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          placeholder={'Título da Task 1\nTítulo da Task 2;Enviar para code review'}
          rows={8}
          disabled={enviando}
        />

        <button
          type="submit"
          className="cadastro-em-lote-panel__submit"
          disabled={enviando || texto.trim().length === 0}
        >
          {enviando ? 'Processando...' : 'Cadastrar em lote'}
        </button>
      </form>

      {enviando && (
        <p role="status" className="cadastro-em-lote-panel__carregando">
          Processando lote...
        </p>
      )}

      {status === 'erro' && (
        <p role="alert" className="cadastro-em-lote-panel__erro">
          {mensagemErro}
        </p>
      )}

      {status === 'sucesso' && resultado && (
        <ul
          className="cadastro-em-lote-panel__relatorio"
          aria-label="Relatório do cadastro em lote"
          data-testid="cadastro-em-lote-relatorio"
        >
          {resultado.length === 0 ? (
            <li className="cadastro-em-lote-panel__relatorio-vazio">
              Nenhuma linha foi enviada para processamento.
            </li>
          ) : (
            resultado.map((linha) => (
              <li
                key={linha.numeroLinha}
                className={
                  linha.aceita
                    ? 'cadastro-em-lote-panel__relatorio-item cadastro-em-lote-panel__relatorio-item--aceita'
                    : 'cadastro-em-lote-panel__relatorio-item cadastro-em-lote-panel__relatorio-item--rejeitada'
                }
                data-testid="cadastro-em-lote-linha"
              >
                <span className="cadastro-em-lote-panel__relatorio-numero">
                  Linha {linha.numeroLinha}:
                </span>{' '}
                <span className="cadastro-em-lote-panel__relatorio-texto">
                  &quot;{linha.linha}&quot;
                </span>{' '}
                {linha.aceita ? (
                  <span className="cadastro-em-lote-panel__relatorio-status">Aceita</span>
                ) : (
                  <span className="cadastro-em-lote-panel__relatorio-status">
                    Rejeitada
                    {linha.motivoMensagem ? ` — ${linha.motivoMensagem}` : ''}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}

export default CadastroEmLotePanel;
