// RegistrarAcordoForm — formulário para registrar o primeiro/próximo
// Acordo de uma Task (design.md > Frontend Components >
// RegistrarAcordoForm), submetendo para `POST /tasks/:id/acordos`.
//
// Serve tanto para Task_Nova (Requisitos 2.1, 2.2 — primeiro Acordo)
// quanto para uma Task_Com_Acordo cujo Acordo_Atual já foi avaliado
// (Requisitos 5.1, 5.2, 5.6, 5.7, 5.8 — próximo Acordo): o backend
// (`AcordoService.registrarAcordo`) trata os dois casos na mesma rota, e
// este componente apenas coleta Tipo_de_Acordo (obrigatório) e
// Responsável (opcional) e submete.
//
// Requisito 2.1/5.1: seleção de Tipo_de_Acordo é obrigatória.
// Requisito 2.2/5.4: Tipo_de_Acordo inválido é rejeitado pela API — o
// erro é exibido preservando o estado do formulário (nada é limpo).
// Requisito 5.2/5.6/5.7: Responsável é opcional; quando não selecionado,
// não é enviado no corpo da requisição (mantém o Responsável atual da
// Task no caso do "próximo Acordo").
// Requisito 5.8: Responsável inválido é rejeitado pela API — o erro é
// exibido sem perder a seleção atual do formulário.

import { useEffect, useState, type FormEvent } from 'react';
import { listarTiposDeAcordo, listarUsuarios, registrarAcordo } from '../api/client';
import { ApiError } from '../api/errors';
import type { Acordo, TipoAcordo, UsuarioCadastrado } from '../api/types';
import './RegistrarAcordoForm.css';

type StatusCarregamento = 'carregando' | 'sucesso' | 'erro';

export interface RegistrarAcordoFormProps {
  /** Id da Task para a qual o Acordo será registrado. */
  taskId: string;
  /** Chamado com o Acordo criado após o registro ter sido aceito pela API. */
  onRegistrado: (acordo: Acordo) => void;
}

export function RegistrarAcordoForm({ taskId, onRegistrado }: RegistrarAcordoFormProps) {
  const [tiposDeAcordo, setTiposDeAcordo] = useState<TipoAcordo[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioCadastrado[]>([]);
  const [statusCarregamento, setStatusCarregamento] = useState<StatusCarregamento>('carregando');
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);

  const [tipoAcordoId, setTipoAcordoId] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroSubmissao, setErroSubmissao] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    setStatusCarregamento('carregando');
    setErroCarregamento(null);

    Promise.all([listarTiposDeAcordo(), listarUsuarios()])
      .then(([resultadoTipos, resultadoUsuarios]) => {
        if (cancelado) return;
        setTiposDeAcordo(resultadoTipos);
        setUsuarios(resultadoUsuarios);
        setStatusCarregamento('sucesso');
      })
      .catch((error: unknown) => {
        if (cancelado) return;
        const mensagem =
          error instanceof ApiError
            ? error.message
            : 'Não foi possível carregar Tipos de Acordo e Usuários.';
        setErroCarregamento(mensagem);
        setStatusCarregamento('erro');
      });

    return () => {
      cancelado = true;
    };
  }, [taskId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (enviando) {
      return;
    }

    setErroSubmissao(null);
    setEnviando(true);

    registrarAcordo(taskId, {
      tipoAcordoId,
      ...(responsavelId ? { responsavelId } : {}),
    })
      .then((acordo) => {
        setTipoAcordoId('');
        setResponsavelId('');
        onRegistrado(acordo);
      })
      .catch((error: unknown) => {
        const mensagem =
          error instanceof ApiError ? error.message : 'Não foi possível registrar o Acordo.';
        setErroSubmissao(mensagem);
      })
      .finally(() => {
        setEnviando(false);
      });
  }

  if (statusCarregamento === 'carregando') {
    return (
      <p role="status" data-testid="registrar-acordo-form-carregando">
        Carregando Tipos de Acordo e Usuários...
      </p>
    );
  }

  if (statusCarregamento === 'erro') {
    return (
      <p
        role="alert"
        className="registrar-acordo-form__erro"
        data-testid="registrar-acordo-form-erro-carregamento"
      >
        {erroCarregamento}
      </p>
    );
  }

  const tipoAcordoInputId = `registrar-acordo-form-tipo-${taskId}`;
  const responsavelInputId = `registrar-acordo-form-responsavel-${taskId}`;

  return (
    <form
      onSubmit={handleSubmit}
      className="registrar-acordo-form"
      data-testid="registrar-acordo-form"
    >
      <div className="registrar-acordo-form__campo">
        <label htmlFor={tipoAcordoInputId}>Tipo de Acordo</label>
        <select
          id={tipoAcordoInputId}
          value={tipoAcordoId}
          onChange={(event) => setTipoAcordoId(event.target.value)}
          required
          disabled={enviando}
          data-testid="registrar-acordo-form-tipo-select"
        >
          <option value="" disabled>
            Selecione um Tipo de Acordo
          </option>
          {tiposDeAcordo.map((tipo) => (
            <option key={tipo.id} value={tipo.id}>
              {tipo.nome}
            </option>
          ))}
        </select>
      </div>

      <div className="registrar-acordo-form__campo">
        <label htmlFor={responsavelInputId}>Responsável</label>
        <select
          id={responsavelInputId}
          value={responsavelId}
          onChange={(event) => setResponsavelId(event.target.value)}
          disabled={enviando}
          data-testid="registrar-acordo-form-responsavel-select"
        >
          <option value="">Nenhum</option>
          {usuarios.map((usuario) => (
            <option key={usuario.id} value={usuario.id}>
              {usuario.nomeLogin}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={enviando || tipoAcordoId === ''}
        data-testid="registrar-acordo-form-submit"
      >
        {enviando ? 'Registrando...' : 'Registrar Acordo'}
      </button>

      {erroSubmissao && (
        <p
          role="alert"
          className="registrar-acordo-form__erro"
          data-testid="registrar-acordo-form-erro-submissao"
        >
          {erroSubmissao}
        </p>
      )}
    </form>
  );
}

export default RegistrarAcordoForm;
