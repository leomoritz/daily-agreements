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
// Requisito 6.3/6.7: os Usuários são renderizados exatamente na ordem
// recebida do servidor (sem reordenar no cliente).
// Requisito 6.8: falha ao carregar o Cadastro_de_Usuários exibe uma
// mensagem de erro e apresenta o Seletor_de_Responsavel sem nenhuma
// opção, sem impedir a apresentação do restante do formulário (o
// Seletor_de_Tipo_de_Acordo segue a mesma regra, de forma simétrica,
// quando é o carregamento dos Tipos de Acordo que falha).
// Requisito 8.5/9.9/10.4: erro da API na submissão mantém o formulário
// aberto com todos os valores informados preservados.

import { useEffect, useState, type FormEvent } from 'react';
import { listarTiposDeAcordo, listarUsuarios, registrarAcordo } from '../api/client';
import { ApiError } from '../api/errors';
import type { Acordo, EstadoCumprimento, TipoAcordo, UsuarioCadastrado } from '../api/types';
import './RegistrarAcordoForm.css';

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
  /**
   * Quando informado, exibe um botão "Cancelar" ao lado do botão de
   * submissão, chamado ao ser clicado.
   */
  onCancelar?: () => void;
}

export function RegistrarAcordoForm({
  taskId,
  comAcordo,
  estadoCumprimentoAcordoAtual,
  responsavelIdAtual,
  onRegistrado,
  onCancelar,
}: RegistrarAcordoFormProps) {
  const [carregando, setCarregando] = useState(true);
  const [tiposDeAcordo, setTiposDeAcordo] = useState<TipoAcordo[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioCadastrado[]>([]);
  const [erroCarregamentoTipos, setErroCarregamentoTipos] = useState<string | null>(null);
  const [erroCarregamentoUsuarios, setErroCarregamentoUsuarios] = useState<string | null>(null);

  const [tipoAcordoId, setTipoAcordoId] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [confirmaCumprimento, setConfirmaCumprimento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroSubmissao, setErroSubmissao] = useState<string | null>(null);

  // Requisitos 8.1, 8.3, 8.4: a confirmação de cumprimento só é exigida
  // quando o Acordo_Atual está `pendente`; ausente (Task_Nova), `cumprido`
  // ou `nao_cumprido` não exibem o campo.
  const exigeConfirmacaoCumprimento = estadoCumprimentoAcordoAtual === 'pendente';

  useEffect(() => {
    let cancelado = false;

    setCarregando(true);
    setErroCarregamentoTipos(null);
    setErroCarregamentoUsuarios(null);

    Promise.allSettled([listarTiposDeAcordo(), listarUsuarios()]).then(
      ([resultadoTipos, resultadoUsuarios]) => {
        if (cancelado) return;

        if (resultadoTipos.status === 'fulfilled') {
          setTiposDeAcordo(resultadoTipos.value);
        } else {
          setTiposDeAcordo([]);
          const erro = resultadoTipos.reason;
          setErroCarregamentoTipos(
            erro instanceof ApiError ? erro.message : 'Não foi possível carregar os Tipos de Acordo.',
          );
        }

        if (resultadoUsuarios.status === 'fulfilled') {
          const usuariosCarregados = resultadoUsuarios.value;
          setUsuarios(usuariosCarregados);
          // Requisitos 9.1, 9.4, 9.7: pré-seleciona o Responsável atual
          // apenas quando o id informado pertence à lista carregada do
          // servidor; caso contrário (ou sem Responsável) inicia vazio.
          const usuarioAtual = responsavelIdAtual
            ? usuariosCarregados.find((usuario) => usuario.id === responsavelIdAtual)
            : undefined;
          setResponsavelId(usuarioAtual?.id ?? '');
        } else {
          // Requisito 6.8: falha ao carregar o Cadastro_de_Usuários
          // apresenta o Seletor_de_Responsavel sem nenhuma opção.
          setUsuarios([]);
          setResponsavelId('');
          const erro = resultadoUsuarios.reason;
          setErroCarregamentoUsuarios(
            erro instanceof ApiError
              ? erro.message
              : 'Não foi possível carregar a lista de Usuários.',
          );
        }

        setCarregando(false);
      },
    );

    return () => {
      cancelado = true;
    };
  }, [taskId, responsavelIdAtual]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (enviando) {
      return;
    }

    if (tipoAcordoId === '' || (exigeConfirmacaoCumprimento && !confirmaCumprimento)) {
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

  if (carregando) {
    return (
      <p role="status" data-testid="registrar-acordo-form-carregando">
        Carregando Tipos de Acordo e Usuários...
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
        {erroCarregamentoTipos && (
          <p
            role="alert"
            className="registrar-acordo-form__erro"
            data-testid="registrar-acordo-form-erro-tipos"
          >
            {erroCarregamentoTipos}
          </p>
        )}
      </div>

      <div className="registrar-acordo-form__campo">
        <label htmlFor={responsavelInputId}>Responsável</label>
        <select
          id={responsavelInputId}
          value={responsavelId}
          onChange={(event) => setResponsavelId(event.target.value)}
          disabled={enviando}
          data-testid="registrar-acordo-form-responsavel-select"
          className='registrar-acordo-form__select'
        >
          <option value="">Nenhum</option>
          {usuarios.map((usuario) => (
            <option key={usuario.id} value={usuario.id}>
              {usuario.nomeLogin}
            </option>
          ))}
        </select>
        {erroCarregamentoUsuarios && (
          <p
            role="alert"
            className="registrar-acordo-form__erro"
            data-testid="registrar-acordo-form-erro-usuarios"
          >
            {erroCarregamentoUsuarios}
          </p>
        )}
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

      <div className="registrar-acordo-form__acoes">
        <button
          type="submit"
          disabled={enviando || tipoAcordoId === '' || (exigeConfirmacaoCumprimento && !confirmaCumprimento)}
          data-testid="registrar-acordo-form-submit"
        >
          {enviando ? 'Registrando...' : 'Registrar Acordo'}
        </button>
        {onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            data-testid="registrar-acordo-form-cancelar"
          >
            Cancelar
          </button>
        )}
      </div>

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
