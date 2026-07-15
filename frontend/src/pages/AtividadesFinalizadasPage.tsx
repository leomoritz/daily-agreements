// AtividadesFinalizadasPage — página que exibe as Atividades_Finalizadas:
// Tasks concluídas (logicamente removidas da Lista_de_Acordos ao terem um
// Acordo "Finalizar" avaliado como cumprido, ver
// backend/src/services/acordoService.ts > avaliarAcordoAtual). Consome
// `GET /tasks/finalizadas` (via `obterAtividadesFinalizadas`, ver
// src/api/client.ts).
//
// Cada item traz a data de finalização (derivada do Acordo "Finalizar"
// cumprido) e um indicador `finalizadaHoje`, calculado pelo backend a
// partir do dia calendário atual (servidor). Itens finalizados hoje
// recebem um destaque visual (classe
// `atividades-finalizadas-page__item--hoje`) e um texto explícito — sem
// depender apenas da cor — comunicando o destaque.
//
// A lista já chega ordenada por data de finalização decrescente (mais
// recente primeiro), então a página apenas renderiza na ordem recebida.

import { useCallback, useEffect, useState } from 'react';
import { obterAtividadesFinalizadas } from '../api/client';
import { ApiError } from '../api/errors';
import type { AtividadeFinalizadaItem } from '../api/types';
import './AtividadesFinalizadasPage.css';

type Status = 'carregando' | 'sucesso' | 'erro';

/** Formata a data de finalização para exibição (locale pt-BR). */
function formatarDataFinalizacao(dataIso: string): string {
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

export function AtividadesFinalizadasPage() {
  const [atividades, setAtividades] = useState<AtividadeFinalizadaItem[]>([]);
  const [status, setStatus] = useState<Status>('carregando');
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  const carregarAtividades = useCallback(() => {
    setStatus('carregando');
    setMensagemErro(null);

    obterAtividadesFinalizadas()
      .then((resultado) => {
        setAtividades(resultado);
        setStatus('sucesso');
      })
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError
            ? error.message
            : 'Não foi possível carregar as Atividades Finalizadas.';
        setMensagemErro(mensagem);
        setStatus('erro');
      });
  }, []);

  useEffect(() => {
    carregarAtividades();
  }, [carregarAtividades]);

  return (
    <main className="atividades-finalizadas-page">
      <h1>Atividades Finalizadas</h1>

      {status === 'carregando' && <p role="status">Carregando Atividades Finalizadas...</p>}

      {status === 'erro' && (
        <p role="alert" className="atividades-finalizadas-page__erro">
          {mensagemErro}
        </p>
      )}

      {status === 'sucesso' && atividades.length === 0 && (
        <p role="status" className="atividades-finalizadas-page__vazio">
          Nenhuma atividade finalizada até o momento.
        </p>
      )}

      {status === 'sucesso' && atividades.length > 0 && (
        <ul className="atividades-finalizadas-page__lista" data-testid="atividades-finalizadas-lista">
          {atividades.map((atividade) => (
            <li
              key={atividade.id}
              className={
                atividade.finalizadaHoje
                  ? 'atividades-finalizadas-page__item atividades-finalizadas-page__item--hoje'
                  : 'atividades-finalizadas-page__item'
              }
              aria-label={
                atividade.finalizadaHoje
                  ? `Atividade "${atividade.titulo}" finalizada hoje`
                  : `Atividade "${atividade.titulo}"`
              }
              data-testid="atividades-finalizadas-item"
            >
              <h2 className="atividades-finalizadas-page__titulo">{atividade.titulo}</h2>

              {atividade.responsavelNome && (
                <p className="atividades-finalizadas-page__responsavel">
                  <span className="atividades-finalizadas-page__label">Responsável:</span>{' '}
                  {atividade.responsavelNome}
                </p>
              )}

              <p className="atividades-finalizadas-page__data-finalizacao">
                <span className="atividades-finalizadas-page__label">Finalizada em:</span>{' '}
                {formatarDataFinalizacao(atividade.dataFinalizacao)}
              </p>

              {atividade.finalizadaHoje && (
                <p className="atividades-finalizadas-page__destaque-hoje" role="status">
                  <span className="atividades-finalizadas-page__destaque-badge" aria-hidden="true">
                    ✓
                  </span>{' '}
                  Finalizada hoje
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default AtividadesFinalizadasPage;
