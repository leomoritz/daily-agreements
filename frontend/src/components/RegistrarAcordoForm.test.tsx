import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrarAcordoForm } from './RegistrarAcordoForm';
import { ApiError } from '../api/errors';
import type { Acordo, EstadoCumprimento, TipoAcordo, UsuarioCadastrado } from '../api/types';

const { listarTiposDeAcordo, listarUsuarios, registrarAcordo } = vi.hoisted(() => ({
  listarTiposDeAcordo: vi.fn(),
  listarUsuarios: vi.fn(),
  registrarAcordo: vi.fn(),
}));

vi.mock('../api/client', () => ({
  listarTiposDeAcordo,
  listarUsuarios,
  registrarAcordo,
}));

const TIPOS: TipoAcordo[] = [
  { id: 'tipo-1', nome: 'Enviar para review' },
  { id: 'tipo-2', nome: 'Finalizar' },
];

const USUARIOS: UsuarioCadastrado[] = [
  { id: 'user-1', nomeLogin: 'ana.silva' },
  { id: 'user-2', nomeLogin: 'joao.souza' },
];

function criarAcordo(overrides: Partial<Acordo> = {}): Acordo {
  return {
    id: 'acordo-1',
    taskId: 'task-1',
    tipoAcordoId: 'tipo-1',
    responsavelId: null,
    dataRegistro: '2024-05-10T10:00:00.000Z',
    estadoCumprimento: 'pendente',
    motivoNaoCumprimentoId: null,
    ...overrides,
  };
}

async function renderFormularioCarregado(onRegistrado = vi.fn()) {
  render(<RegistrarAcordoForm taskId="task-1" comAcordo={true} onRegistrado={onRegistrado} />);

  const selectTipo = await screen.findByTestId('registrar-acordo-form-tipo-select');
  return { selectTipo, onRegistrado };
}

describe('RegistrarAcordoForm', () => {
  beforeEach(() => {
    listarTiposDeAcordo.mockReset().mockResolvedValue(TIPOS);
    listarUsuarios.mockReset().mockResolvedValue(USUARIOS);
    registrarAcordo.mockReset();
  });

  it('submete com Tipo_de_Acordo e Responsável selecionados, chamando onRegistrado com o Acordo retornado (Requisitos 2.1, 5.1, 5.6)', async () => {
    const acordoRetornado = criarAcordo({ tipoAcordoId: 'tipo-1' });
    registrarAcordo.mockResolvedValue(acordoRetornado);

    const { selectTipo, onRegistrado } = await renderFormularioCarregado();
    const selectResponsavel = screen.getByTestId('registrar-acordo-form-responsavel-select');

    fireEvent.change(selectTipo, { target: { value: 'tipo-1' } });
    fireEvent.change(selectResponsavel, { target: { value: 'user-1' } });
    fireEvent.click(screen.getByTestId('registrar-acordo-form-submit'));

    await waitFor(() => expect(registrarAcordo).toHaveBeenCalledTimes(1));
    expect(registrarAcordo).toHaveBeenCalledWith('task-1', {
      tipoAcordoId: 'tipo-1',
      responsavelId: 'user-1',
    });
    await waitFor(() => expect(onRegistrado).toHaveBeenCalledWith(acordoRetornado));
  });

  it('submete apenas com Tipo_de_Acordo quando nenhum Responsável é selecionado, sem enviar responsavelId (Requisito 5.2)', async () => {
    const acordoRetornado = criarAcordo({ tipoAcordoId: 'tipo-2' });
    registrarAcordo.mockResolvedValue(acordoRetornado);

    const { selectTipo, onRegistrado } = await renderFormularioCarregado();

    fireEvent.change(selectTipo, { target: { value: 'tipo-2' } });
    fireEvent.click(screen.getByTestId('registrar-acordo-form-submit'));

    await waitFor(() => expect(registrarAcordo).toHaveBeenCalledTimes(1));
    expect(registrarAcordo).toHaveBeenCalledWith('task-1', { tipoAcordoId: 'tipo-2' });
    await waitFor(() => expect(onRegistrado).toHaveBeenCalledWith(acordoRetornado));
  });

  it('exibe o erro retornado pela API e preserva a seleção do formulário quando o registro é rejeitado (Requisitos 2.2, 5.4, 5.8)', async () => {
    registrarAcordo.mockRejectedValue(
      new ApiError(400, 'TIPO_DE_ACORDO_INVALIDO', 'Tipo_de_Acordo informado não existe.'),
    );

    const { selectTipo } = await renderFormularioCarregado();
    const selectResponsavel = screen.getByTestId('registrar-acordo-form-responsavel-select');

    fireEvent.change(selectTipo, { target: { value: 'tipo-1' } });
    fireEvent.change(selectResponsavel, { target: { value: 'user-1' } });
    fireEvent.click(screen.getByTestId('registrar-acordo-form-submit'));

    const erro = await screen.findByTestId('registrar-acordo-form-erro-submissao');
    expect(erro).toHaveTextContent('Tipo_de_Acordo informado não existe.');

    expect(selectTipo).toHaveValue('tipo-1');
    expect(selectResponsavel).toHaveValue('user-1');
  });

  // Property 16: Forma do formulário de registro depende do estado do Acordo_Atual
  // Validates: Requirements 8.1, 8.3
  it('Feature: melhorias-acordos, Property 16: Forma do formulário de registro depende do estado do Acordo_Atual', async () => {
    const estadoArb: fc.Arbitrary<EstadoCumprimento | undefined> = fc.constantFrom(
      undefined,
      'pendente',
      'cumprido',
      'nao_cumprido',
    );

    await fc.assert(
      fc.asyncProperty(estadoArb, fc.boolean(), async (estadoCumprimentoAcordoAtual, comAcordo) => {
        registrarAcordo.mockReset();

        const { unmount } = render(
          <RegistrarAcordoForm
            taskId="task-1"
            comAcordo={comAcordo}
            estadoCumprimentoAcordoAtual={estadoCumprimentoAcordoAtual}
            onRegistrado={vi.fn()}
          />,
        );

        await screen.findByTestId('registrar-acordo-form-tipo-select');

        const exibeConfirmacao = estadoCumprimentoAcordoAtual === 'pendente' && comAcordo;

        if (exibeConfirmacao) {
          const checkbox = screen.getByTestId('registrar-acordo-form-confirma-cumprimento');
          expect(checkbox).toBeInTheDocument();

          const submit = screen.getByTestId('registrar-acordo-form-submit');
          fireEvent.change(screen.getByTestId('registrar-acordo-form-tipo-select'), {
            target: { value: 'tipo-1' },
          });
          expect(submit).toBeDisabled();

          fireEvent.click(checkbox);
          expect(submit).not.toBeDisabled();
        } else {
          expect(
            screen.queryByTestId('registrar-acordo-form-confirma-cumprimento'),
          ).not.toBeInTheDocument();
        }

        // Nenhuma requisição de registro deve ocorrer apenas pela renderização
        // do formulário, independentemente do estado do Acordo_Atual.
        expect(registrarAcordo).not.toHaveBeenCalled();

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  // Property 23: Pré-seleção do Responsável nos formulários
  // Validates: Requirements 9.1, 9.4, 9.6, 9.7
  it('Feature: melhorias-acordos, Property 23: Pré-seleção do Responsável nos formulários', async () => {
    const usuarioArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim() !== ''),
      nomeLogin: fc.string({ minLength: 1, maxLength: 20 }),
    });
    const usuariosArb = fc.uniqueArray(usuarioArb, {
      selector: (usuario) => usuario.id,
      maxLength: 5,
    });

    // Combina a lista de Usuários carregada com um `responsavelIdAtual` que
    // pode estar ausente (`undefined`), pertencer a um Usuário da lista ou
    // não corresponder a nenhum Usuário cadastrado.
    const casoArb = usuariosArb.chain((usuarios) => {
      const idPertencenteArb =
        usuarios.length > 0
          ? fc.constantFrom(...usuarios.map((usuario) => usuario.id))
          : fc.constant(undefined);
      const idInexistenteArb = fc
        .string({ minLength: 1, maxLength: 12 })
        .filter((s) => !usuarios.some((usuario) => usuario.id === s));

      return fc.record({
        usuarios: fc.constant(usuarios),
        responsavelIdAtual: fc.oneof(fc.constant(undefined), idPertencenteArb, idInexistenteArb),
      });
    });

    await fc.assert(
      fc.asyncProperty(casoArb, async ({ usuarios, responsavelIdAtual }) => {
        listarTiposDeAcordo.mockReset().mockResolvedValue(TIPOS);
        listarUsuarios.mockReset().mockResolvedValue(usuarios);

        const { unmount } = render(
          <RegistrarAcordoForm
            taskId="task-1"
            comAcordo={true}
            responsavelIdAtual={responsavelIdAtual}
            onRegistrado={vi.fn()}
          />,
        );

        await screen.findByTestId('registrar-acordo-form-tipo-select');
        const selectResponsavel = screen.getByTestId(
          'registrar-acordo-form-responsavel-select',
        ) as HTMLSelectElement;

        // Requisitos 9.1, 9.4, 9.7: o Seletor_de_Responsavel inicia com o
        // Usuário correspondente a `responsavelIdAtual` selecionado somente
        // quando esse id pertence à lista carregada; caso contrário (ou sem
        // `responsavelIdAtual`), inicia vazio.
        const pertenceAoCadastro =
          responsavelIdAtual !== undefined &&
          usuarios.some((usuario) => usuario.id === responsavelIdAtual);

        expect(selectResponsavel.value).toBe(pertenceAoCadastro ? responsavelIdAtual : '');

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  // Property 20: O cliente preserva a ordem recebida do servidor
  // Validates: Requirements 6.3, 6.6, 6.7
  it('Feature: melhorias-acordos, Property 20: O cliente preserva a ordem recebida do servidor', async () => {
    const usuarioArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim() !== ''),
      nomeLogin: fc.string({ minLength: 1, maxLength: 20 }),
    });
    const usuariosArb = fc.uniqueArray(usuarioArb, {
      selector: (usuario) => usuario.id,
      maxLength: 8,
    });

    await fc.assert(
      fc.asyncProperty(usuariosArb, async (usuarios) => {
        listarTiposDeAcordo.mockReset().mockResolvedValue(TIPOS);
        listarUsuarios.mockReset().mockResolvedValue(usuarios);

        const { unmount } = render(
          <RegistrarAcordoForm taskId="task-1" comAcordo={true} onRegistrado={vi.fn()} />,
        );

        await screen.findByTestId('registrar-acordo-form-tipo-select');
        const selectResponsavel = screen.getByTestId(
          'registrar-acordo-form-responsavel-select',
        ) as HTMLSelectElement;

        // A primeira opção é sempre o placeholder "Nenhum" (value vazio); as
        // demais devem corresponder exatamente, na mesma ordem — sem
        // reordenar, omitir, truncar ou duplicar —, aos Usuários retornados
        // pelo servidor, incluindo quando a lista é vazia (Requisitos 6.3,
        // 6.6, 6.7).
        const opcoes = Array.from(selectResponsavel.options);
        expect(opcoes[0].value).toBe('');

        const opcoesUsuarios = opcoes.slice(1);
        expect(opcoesUsuarios).toHaveLength(usuarios.length);
        opcoesUsuarios.forEach((opcao, index) => {
          expect(opcao.value).toBe(usuarios[index].id);
          expect(opcao.textContent).toBe(usuarios[index].nomeLogin);
        });

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('bloqueia a submissão quando o Acordo_Atual está pendente e a confirmação de cumprimento não foi marcada, preservando os valores informados (Requisito 8.11)', async () => {
    render(
      <RegistrarAcordoForm
        taskId="task-1"
        comAcordo={true}
        estadoCumprimentoAcordoAtual="pendente"
        onRegistrado={vi.fn()}
      />,
    );

    const selectTipo = await screen.findByTestId('registrar-acordo-form-tipo-select');
    const selectResponsavel = screen.getByTestId('registrar-acordo-form-responsavel-select');
    const submit = screen.getByTestId('registrar-acordo-form-submit');

    fireEvent.change(selectTipo, { target: { value: 'tipo-1' } });
    fireEvent.change(selectResponsavel, { target: { value: 'user-1' } });

    // Sem a confirmação de cumprimento marcada, o submit permanece desabilitado
    // e nenhuma submissão é enviada à API.
    expect(submit).toBeDisabled();
    fireEvent.click(submit);

    expect(registrarAcordo).not.toHaveBeenCalled();
    expect(selectTipo).toHaveValue('tipo-1');
    expect(selectResponsavel).toHaveValue('user-1');
  });

  it('exibe o erro de Responsável não cadastrado retornado pela API e preserva os valores selecionados no formulário (Requisito 9.9)', async () => {
    registrarAcordo.mockRejectedValue(
      new ApiError(400, 'RESPONSAVEL_NAO_ENCONTRADO', 'Responsável informado não está cadastrado.'),
    );

    const { selectTipo } = await renderFormularioCarregado();
    const selectResponsavel = screen.getByTestId('registrar-acordo-form-responsavel-select');

    fireEvent.change(selectTipo, { target: { value: 'tipo-2' } });
    fireEvent.change(selectResponsavel, { target: { value: 'user-2' } });
    fireEvent.click(screen.getByTestId('registrar-acordo-form-submit'));

    const erro = await screen.findByTestId('registrar-acordo-form-erro-submissao');
    expect(erro).toHaveTextContent('Responsável informado não está cadastrado.');

    expect(selectTipo).toHaveValue('tipo-2');
    expect(selectResponsavel).toHaveValue('user-2');
  });

  it('exibe erro ao falhar o carregamento de Usuários e apresenta o Seletor_de_Responsavel sem opções, mantendo o restante do formulário utilizável (Requisito 6.8)', async () => {
    listarUsuarios
      .mockReset()
      .mockRejectedValue(new ApiError(500, 'ERRO_INTERNO', 'Não foi possível carregar a lista de Usuários.'));

    render(<RegistrarAcordoForm taskId="task-1" comAcordo={true} onRegistrado={vi.fn()} />);

    const selectTipo = await screen.findByTestId('registrar-acordo-form-tipo-select');
    const erroUsuarios = await screen.findByTestId('registrar-acordo-form-erro-usuarios');
    expect(erroUsuarios).toHaveTextContent('Não foi possível carregar a lista de Usuários.');

    const selectResponsavel = screen.getByTestId(
      'registrar-acordo-form-responsavel-select',
    ) as HTMLSelectElement;
    // Apenas a opção placeholder "Nenhum" é apresentada; nenhum Usuário é listado.
    expect(selectResponsavel.options).toHaveLength(1);
    expect(selectResponsavel.options[0].value).toBe('');

    // O restante do formulário (Seletor_de_Tipo_de_Acordo) continua utilizável.
    fireEvent.change(selectTipo, { target: { value: 'tipo-1' } });
    expect(selectTipo).toHaveValue('tipo-1');
  });
});
