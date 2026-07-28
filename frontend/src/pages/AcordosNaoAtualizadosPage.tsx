// AcordosNaoAtualizadosPage — página que exibe a Lista_de_Acordos_Nao_Atualizados
// (design.md "Frontend — Componentes" > AcordosNaoAtualizadosPage,
// Requisito 7). Consome `GET /tasks/nao-atualizados` (via
// `obterAcordosNaoAtualizados`, ver src/api/client.ts), que já aplica o
// timeout de 3 s (Requisito 7.2, 7.11) através do wrapper de fetch
// (ver src/api/http.ts).
//
// Cada item exibe título, Responsável (quando houver), a
// Data_de_Ultima_Atualizacao_de_Acordo em dd/mm/aaaa e o Tipo_de_Acordo
// do Acordo_Atual (quando houver); quando a Task não possui nenhum
// Acordo registrado, o item exibe "Sem Acordo registrado" no lugar da
// data e do tipo, mantendo título e Responsável (Requisito 7.6, 7.10).
//
// Lista vazia exibe uma indicação de que todas as Tasks ativas possuem
// Acordo registrado hoje, sem nenhum item (Requisito 7.8).
//
// Em falha ou timeout de 3 s, a indicação de carregamento é encerrada, a
// aba permanece selecionada, uma mensagem de erro é exibida e uma ação de
// "Tentar novamente" é oferecida, sem alterar Tasks, Acordos ou
// contadores (Requisito 7.11).
//
// Os dados são recarregados a cada montagem da página (Requisito 10.8),
// como em `AtividadesFinalizadasPage`.

import { useCallback, useEffect, useState } from 'react';
import { obterAcordosNaoAtualizados } from '../api/client';
import { ApiError } from '../api/errors';
import type { TaskNaoAtualizadaItem } from '../api/types';
import './AcordosNaoAtualizadosPage.css';

type Status = 'carregando' | 'sucesso' | 'erro';

/** Formata a Data_de_Ultima_Atualizacao_de_Acordo em dd/mm/aaaa (Requisito 7.6). */
function formatarData(dataIso: string): string {
  const data = new Date(dataIso);
  if (Number.isNaN(data.getTime())) {
    return dataIso;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(data);
}

export function AcordosNaoAtualizadosPage() {
  const [itens, setItens] = useState<TaskNaoAtualizadaItem[]>([]);
  const [status, setStatus] = useState<Status>('carregando');
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  const carregarItens = useCallback(() => {
    setStatus('carregando');
    setMensagemErro(null);

    obterAcordosNaoAtualizados()
      .then((resultado) => {
        setItens(resultado);
        setStatus('sucesso');
      })
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError
            ? error.message
            : 'Não foi possível carregar a lista de Acordos Não Atualizados.';
        setMensagemErro(mensagem);
        setStatus('erro');
      });
  }, []);

  useEffect(() => {
    carregarItens();
  }, [carregarItens]);

  return (
    <main className="acordos-nao-atualizados-page">
      <h1>Acordos Não Atualizados</h1>

      {status === 'carregando' && (
        <p role="status">Carregando Acordos Não Atualizados...</p>
      )}

      {status === 'erro' && (
        <div className="acordos-nao-atualizados-page__erro-container">
          <p role="alert" className="acordos-nao-atualizados-page__erro">
            {mensagemErro}
          </p>
          <button
            type="button"
            onClick={carregarItens}
            data-testid="acordos-nao-atualizados-page-tentar-novamente"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {status === 'sucesso' && itens.length === 0 && (
        <p role="status" className="acordos-nao-atualizados-page__vazio">
          Todas as Tasks ativas possuem Acordo registrado hoje
        </p>
      )}

      {status === 'sucesso' && itens.length > 0 && (
        <ul
          className="acordos-nao-atualizados-page__lista"
          data-testid="acordos-nao-atualizados-lista"
        >
          {itens.map((item) => (
            <li
              key={item.id}
              className="acordos-nao-atualizados-page__item"
              data-testid="acordos-nao-atualizados-item"
            >
              <h2 className="acordos-nao-atualizados-page__titulo">{item.titulo}</h2>

              {item.responsavelNome && (
                <p className="acordos-nao-atualizados-page__responsavel">
                  <span className="acordos-nao-atualizados-page__label">Responsável:</span>{' '}
                  {item.responsavelNome}
                </p>
              )}

              {item.dataUltimaAtualizacaoAcordo ? (
                <>
                  <p className="acordos-nao-atualizados-page__data">
                    <span className="acordos-nao-atualizados-page__label">
                      Última atualização:
                    </span>{' '}
                    {formatarData(item.dataUltimaAtualizacaoAcordo)}
                  </p>
                  {item.tipoAcordoNome && (
                    <p className="acordos-nao-atualizados-page__tipo-acordo">
                      <span className="acordos-nao-atualizados-page__label">
                        Tipo de Acordo:
                      </span>{' '}
                      {item.tipoAcordoNome}
                    </p>
                  )}
                </>
              ) : (
                <p className="acordos-nao-atualizados-page__sem-acordo">
                  Sem Acordo registrado
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default AcordosNaoAtualizadosPage;
