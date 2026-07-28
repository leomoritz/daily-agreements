// RegistrarAcordoForm — formulário para registrar o primeiro/próximo
// Acordo de uma Task (design.md > Frontend Components >
// RegistrarAcordoForm), submetendo para `POST /tasks/:id/acordos`.
//
// Serve tanto para Task_Nova (Requisitos 2.1, 2.2, 8.3 — primeiro
// Acordo) quanto para uma Task_Com_Acordo cujo Acordo_Atual já foi
// avaliado (Requisitos 5.1, 5.2, 5.6, 5.7, 5.8, 8.4 — próximo Acordo) ou
// ainda está `pendente` (Requisito 8 — Registro_de_Acordo_com_Avaliacao):
// o backend (`AcordoService.registrarAcordo`) trata todos os casos na
// mesma rota, e este componente coleta Tipo_de_Acordo (obrigatório),
// Responsável (opcional, pré-selecionado com o atual) e, quando o
// Acordo_Atual está pendente, a confirmação obrigatória de cumprimento.
//
// Requisito 2.1/5.1: seleção de Tipo_de_Acordo é obrigatória.
// Requisito 2.2/5.4: Tipo_de_Acordo inválido é rejeitado pela API — o
// erro é exibido preservando o estado do formulário (nada é limpo).
// Requisito 5.2/5.6/5.7/9.8: Responsável é opcional; quando não
// selecionado, não é enviado no corpo da requisição (mantém o
// Responsável atual da Task).
// Requisito 5.8/9.9: Responsável inválido é rejeitado pela API — o erro
// é exibido sem perder a seleção atual do formulário.
// Requisito 8.1/8.2/8.3/8.4/8.11: com `estadoCumprimentoAcordoAtual ===
// 'pendente'`, exibe um checkbox obrigatório "O acordo atual foi
// cumprido"; o submit só é habilitado com ele marcado, e a submissão
// envia `confirmaCumprimentoAcordoAtual: true`. Para Task_Nova ou
// Acordo_Atual já avaliado (`estadoCumprimentoAcordoAtual` ausente,
// `cumprido` ou `nao_cumprido`), o campo não é exibido.
// Requisito 9.1/9.4/9.7: o Seletor_de_Responsavel inicia com
// `responsavelIdAtual` pré-selecionado quando esse id existe na lista
// carregada de `GET /usuarios`; sem correspondência (ou sem
// Responsável), inicia vazio.
// Requisito 6.3/6.7/6.8: os Usuários são renderizados exatamente na
// ordem recebida do servidor (sem reordenar no cliente); falha no
// carregamento exibe erro e não apresenta nenhuma opção no seletor.
// Requisito 8.5/9.9/10.4: erro da API mantém o formulário aberto com
// todos os valores informados preservados.

import { useEffect, useState, type FormEvent } from 'react';
import { listarTiposDeAcordo, listarUsuarios, registrarAcordo } from '../api/client';
import { ApiError } from '../api/errors';
import type { Acordo, EstadoCumprimento, TipoAcordo, UsuarioCadastrado } from '../api/types';
import './RegistrarAcordoForm.css';
import { itemsEqual } from '@dnd-kit/sortable/dist/utilities';

type StatusCarregamento = 'carregando' | 'sucesso' | 'erro';

export interface RegistrarAcordoFormProps {
  /** Id da Task para a qual o Acordo será registrado. */
  taskId: string;
  /** Indica se já existe acordo */
  comAcordo: boolean;
  /**
   * Estado de cumprimento corrente do Acordo_Atual da Task, quando
   * houver. Ausente para Task_Nova. Quando `'pendente'`, o formulário
   * exige a confirmação de cumprimento antes de permitir o registro do
   * novo Acordo (Requisitos 8.1, 8.2, 8.11).
   */
  estadoCumprimentoAcordoAtual?: EstadoCumprimento;
  /**
   * Id do Responsável atual da Task, quando houver (Requisito 9.5), usado
   * para pré-selecionar o Seletor_de_Responsavel (Requisitos 9.1, 9.4, 9.7).
   */
  responsavelIdAtual?: string;
  /** Chamado com o Acordo criado após o registro ter sido aceito pela API. */
  onRegistrado: (acordo: Acordo) => void;
}

export function RegistrarAcordoForm({
  taskId,
  comAcordo,
  estadoCumprimentoAcordoAtual,
  responsavelIdAtual,
  onRegistrado,
}: RegistrarAcordoFormProps) {

  const [tiposDeAcordo, setTiposDeAcordo] = useState<TipoAcordo[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioCadastrado[]>([]);
  const [statusCarregamento, setStatusCarregamento] = useState<StatusCarregamento>('carregando');
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);

  const [tipoAcordoId, setTipoAcordoId] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [confirmaCumprimento, setConfirmaCumprimento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroSubmissao, setErroSubmissao] = useState<string | null>(null);

  const exigeConfirmacaoCumprimento = estadoCumprimentoAcordoAtual === 'pendente' || 'nao_cumprido';

  useEffect(() => {
    let cancelado = false;

    setStatusCarregamento('carregando');
    setErroCarregamento(null);

    Promise.all([listarTiposDeAcordo(), listarUsuarios()])
      .then(([resultadoTipos, resultadoUsuarios]) => {
        if (cancelado) return;
        setTiposDeAcordo(resultadoTipos);
        setUsuarios(resultadoUsuarios);
        // Requisitos 9.1, 9.4, 9.7: pré-seleciona o Responsável atual
        // apenas quando o id informado pertence à lista carregada do
        // servidor; caso contrário (ou sem Responsável) inicia vazio.
        const usuarioAtual = responsavelIdAtual
          ? resultadoUsuarios.find((usuario) => usuario.id === responsavelIdAtual)
          : undefined;
        setResponsavelId(usuarioAtual?.id ?? '');
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
  }, [taskId, responsavelIdAtual]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (enviando) {
      return;
    }

    if (exigeConfirmacaoCumprimento && !confirmaCumprimento) {
      return;
    }

    setErroSubmissao(null);
    setEnviando(true);

    registrarAcordo(taskId, {
      tipoAcordoId,
      ...(responsavelId ? { responsavelId } : {}),
      ...(exigeConfirmacaoCumprimento ? { confirmaCumprimentoAcordoAtual: true } : {}),
    })
      .then((acordo) => {
        setTipoAcordoId('');
        setResponsavelId('');
        setConfirmaCumprimento(false);
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
  const confirmaCumprimentoInputId = `registrar-acordo-form-confirma-cumprimento-${taskId}`;

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

      {exigeConfirmacaoCumprimento && comAcordo && (
        <div className="registrar-acordo-form__campo registrar-acordo-form__campo--checkbox">
          <label htmlFor={confirmaCumprimentoInputId}>
            <input
              id={confirmaCumprimentoInputId}
              type="checkbox"
              checked={confirmaCumprimento}
              onChange={(event) => setConfirmaCumprimento(event.target.checked)}
              disabled={enviando}
              required
              data-testid="registrar-acordo-form-confirma-cumprimento"
            />
            O acordo atual foi cumprido
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={
          enviando || tipoAcordoId === '' || (exigeConfirmacaoCumprimento && !confirmaCumprimento)
        }
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
