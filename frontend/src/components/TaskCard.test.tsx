import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { TaskCard } from './TaskCard';
import { ApiError } from '../api/errors';
import type { TaskComAcordoItem, TaskNovaItem } from '../api/types';

const {
  editarTask,
  removerTask,
  listarUsuarios,
  repetirUltimoAcordo,
  finalizarTask,
  avaliarAcordoAtual,
  listarMotivos,
} = vi.hoisted(() => ({
  editarTask: vi.fn(),
  removerTask: vi.fn(),
  listarUsuarios: vi.fn(),
  repetirUltimoAcordo: vi.fn(),
  finalizarTask: vi.fn(),
  avaliarAcordoAtual: vi.fn(),
  listarMotivos: vi.fn(),
}));

vi.mock('../api/client', () => ({
  editarTask,
  removerTask,
  listarUsuarios,
  repetirUltimoAcordo,
  finalizarTask,
  avaliarAcordoAtual,
  listarMotivos,
}));

function criarTaskNova(overrides: Partial<TaskNovaItem> = {}): TaskNovaItem {
  return {
    id: 'task-nova-1',
    titulo: 'Investigar bug de login',
    ordemExibicao: 0,
    ...overrides,
  };
}

function criarTaskComAcordo(overrides: Partial<TaskComAcordoItem> = {}): TaskComAcordoItem {
  return {
    id: 'task-acordo-1',
    titulo: 'Enviar para review',
    ordemExibicao: 0,
    tipoAcordoNome: 'Enviar para review',
    estadoCumprimentoAcordoAtual: 'pendente',
    dataRegistroAcordoAtual: '2024-05-10T10:00:00.000Z',
    alerta: false,
    numTentativas: 0,
    alertaTentativasAvaliarPlanejar: false,
    tentativasAvaliarPlanejar: 0,
    ...overrides,
  };
}

describe('TaskCard', () => {
  it('renders título e Responsável quando presentes (Task_Nova)', () => {
    render(<TaskCard item={criarTaskNova({ responsavelNome: 'ana.silva' })} />);

    expect(screen.getByText('Investigar bug de login')).toBeInTheDocument();
    expect(screen.getByText('ana.silva')).toBeInTheDocument();
  });

  it('não renderiza Responsável quando ausente', () => {
    render(<TaskCard item={criarTaskNova({ responsavelNome: undefined })} />);

    expect(screen.queryByText(/Responsável:/i)).not.toBeInTheDocument();
  });

  it('renderiza Tipo_de_Acordo e data de registro para Task_Com_Acordo', () => {
    render(
      <TaskCard
        item={criarTaskComAcordo({
          tipoAcordoNome: 'Enviar para deploy',
          dataRegistroAcordoAtual: '2024-05-10T10:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByText(/Enviar para deploy/)).toBeInTheDocument();
    expect(screen.getByText(/Registrado em:/i)).toBeInTheDocument();
  });

  it('renderiza indicador de alerta e Nº_Tentativas quando alerta é true (Requisito 3.6)', () => {
    render(<TaskCard item={criarTaskComAcordo({ alerta: true, numTentativas: 3 })} />);

    const card = screen.getByTestId('task-card');
    expect(card.className).toContain('task-card--alerta');
    // Requisito 1.4: o texto do alerta não contém o contador de tentativas
    // (a única origem do valor é o Campo_Numero_de_Tentativas).
    const alertaStatus = screen.getByRole('status');
    expect(alertaStatus).toHaveTextContent(/alerta/i);
    expect(alertaStatus.textContent ?? '').not.toMatch(/\d/);
    expect(screen.getByTestId('task-card-num-tentativas')).toHaveTextContent('3');
  });

  it('não renderiza indicador de alerta quando alerta é false', () => {
    render(<TaskCard item={criarTaskComAcordo({ alerta: false })} />);

    const card = screen.getByTestId('task-card');
    expect(card.className).not.toContain('task-card--alerta');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('não renderiza indicador de alerta para Task_Nova', () => {
    render(<TaskCard item={criarTaskNova()} />);

    const card = screen.getByTestId('task-card');
    expect(card.className).not.toContain('task-card--alerta');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renderiza indicador de alerta de tentativas de Avaliar e planejar alto quando alertaTentativasAvaliarPlanejar é true', () => {
    render(
      <TaskCard
        item={criarTaskComAcordo({ alertaTentativasAvaliarPlanejar: true, tentativasAvaliarPlanejar: 3 })}
      />,
    );

    const card = screen.getByTestId('task-card');
    expect(card.className).toContain('task-card--alerta');
    // Requisito 1.5: o texto do alerta não contém o contador de tentativas
    // (a única origem do valor é o Campo_Numero_de_Tentativas).
    const alertaStatus = screen.getByRole('status');
    expect(alertaStatus).toHaveTextContent(/Avaliar e planejar/i);
    expect(alertaStatus.textContent ?? '').not.toMatch(/\d/);
    expect(screen.getByTestId('task-card-num-tentativas')).toHaveTextContent('0');
  });

  it('não renderiza indicador de alerta de tentativas de Avaliar e planejar quando alertaTentativasAvaliarPlanejar é false', () => {
    render(<TaskCard item={criarTaskComAcordo({ alertaTentativasAvaliarPlanejar: false })} />);

    const card = screen.getByTestId('task-card');
    expect(card.className).not.toContain('task-card--alerta');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('rejeita edição com título vazio, exibindo o erro e mantendo o modo de edição (Requisito 9.2)', async () => {
    listarUsuarios.mockResolvedValue([]);
    editarTask.mockRejectedValue(new ApiError(400, 'TITULO_INVALIDO', 'Título é obrigatório.'));
    const onTaskEditada = vi.fn();

    render(<TaskCard item={criarTaskNova()} onTaskEditada={onTaskEditada} />);

    fireEvent.click(screen.getByTestId('task-card-editar'));

    const inputTitulo = await screen.findByTestId('task-card-editar-titulo');
    fireEvent.change(inputTitulo, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('task-card-salvar'));

    expect(await screen.findByTestId('task-card-erro-edicao')).toHaveTextContent(
      'Título é obrigatório.',
    );
    // Continua em modo de edição: o formulário/input ainda estão presentes.
    expect(screen.getByTestId('task-card-editar-form')).toBeInTheDocument();
    expect(screen.getByTestId('task-card-editar-titulo')).toHaveValue('');
    expect(onTaskEditada).not.toHaveBeenCalled();
  });

  describe('Repetir último acordo', () => {
    it('exibe o botão "Repetir último acordo" para Task_Com_Acordo com Acordo_Atual não cumprido quando onAcordoAlterado é informado', () => {
      const { rerender } = render(
        <TaskCard
          item={criarTaskComAcordo({ estadoCumprimentoAcordoAtual: 'nao_cumprido' })}
          onAcordoAlterado={vi.fn()}
        />,
      );
      expect(screen.getByTestId('task-card-repetir-ultimo-acordo')).toBeInTheDocument();

      rerender(<TaskCard item={criarTaskNova()} onAcordoAlterado={vi.fn()} />);
      expect(screen.queryByTestId('task-card-repetir-ultimo-acordo')).not.toBeInTheDocument();
    });

    it('exibe o botão "Repetir último acordo" para Task_Com_Acordo do tipo "Avaliar e planejar" mesmo com Acordo_Atual pendente', () => {
      render(
        <TaskCard
          item={criarTaskComAcordo({
            tipoAcordoNome: 'Avaliar e planejar',
            estadoCumprimentoAcordoAtual: 'pendente',
          })}
          onAcordoAlterado={vi.fn()}
        />,
      );
      expect(screen.getByTestId('task-card-repetir-ultimo-acordo')).toBeInTheDocument();
    });

    it('não exibe o botão quando o Acordo_Atual está pendente ou cumprido com outro Tipo_de_Acordo', () => {
      const { rerender } = render(
        <TaskCard
          item={criarTaskComAcordo({
            tipoAcordoNome: 'Enviar para review',
            estadoCumprimentoAcordoAtual: 'pendente',
          })}
          onAcordoAlterado={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('task-card-repetir-ultimo-acordo')).not.toBeInTheDocument();

      rerender(
        <TaskCard
          item={criarTaskComAcordo({
            tipoAcordoNome: 'Enviar para review',
            estadoCumprimentoAcordoAtual: 'cumprido',
          })}
          onAcordoAlterado={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('task-card-repetir-ultimo-acordo')).not.toBeInTheDocument();
    });

    it('não exibe o botão quando onAcordoAlterado não é informado', () => {
      render(<TaskCard item={criarTaskComAcordo({ estadoCumprimentoAcordoAtual: 'nao_cumprido' })} />);
      expect(screen.queryByTestId('task-card-repetir-ultimo-acordo')).not.toBeInTheDocument();
    });

    it('chama repetirUltimoAcordo com o id da Task e onAcordoAlterado ao clicar no botão', async () => {
      repetirUltimoAcordo.mockResolvedValue({
        id: 'acordo-novo',
        taskId: 'task-acordo-1',
        tipoAcordoId: 'tipo-1',
        dataRegistro: '2024-05-11T10:00:00.000Z',
        estadoCumprimento: 'pendente',
        motivoNaoCumprimentoId: null,
      });
      const onAcordoAlterado = vi.fn();

      // Requisitos 4.1, 4.3: tipoAcordoNome "Avaliar e planejar" com
      // tentativasAvaliarPlanejar < 2 exercita o caminho de chamada direta
      // à API, sem apresentar o Modal_de_Motivo.
      render(
        <TaskCard
          item={criarTaskComAcordo({ id: 'task-acordo-1', tipoAcordoNome: 'Avaliar e planejar' })}
          onAcordoAlterado={onAcordoAlterado}
        />,
      );

      fireEvent.click(screen.getByTestId('task-card-repetir-ultimo-acordo'));

      expect(screen.queryByTestId('motivo-modal')).not.toBeInTheDocument();
      expect(repetirUltimoAcordo).toHaveBeenCalledWith('task-acordo-1');
      await waitFor(() => expect(onAcordoAlterado).toHaveBeenCalled());
    });

    it('exibe erro e não chama onAcordoAlterado quando a API rejeita', async () => {
      repetirUltimoAcordo.mockRejectedValue(
        new ApiError(409, 'SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.'),
      );
      const onAcordoAlterado = vi.fn();

      render(
        <TaskCard
          item={criarTaskComAcordo({ tipoAcordoNome: 'Avaliar e planejar' })}
          onAcordoAlterado={onAcordoAlterado}
        />,
      );

      fireEvent.click(screen.getByTestId('task-card-repetir-ultimo-acordo'));

      expect(await screen.findByTestId('task-card-erro-repetir')).toHaveTextContent(
        'A Task não possui Acordo_Atual.',
      );
      expect(onAcordoAlterado).not.toHaveBeenCalled();
    });

    it('abre o Modal_de_Motivo com o Ultimo_Motivo_Informado pré-selecionado', async () => {
      listarMotivos.mockResolvedValue([]);

      render(
        <TaskCard
          item={criarTaskComAcordo({
            tipoAcordoNome: 'Enviar para review',
            estadoCumprimentoAcordoAtual: 'nao_cumprido',
            ultimoMotivoNome: 'Dependência externa',
          })}
          onAcordoAlterado={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('task-card-repetir-ultimo-acordo'));

      const combobox = (await screen.findByTestId('motivo-modal-combobox')) as HTMLInputElement;
      expect(combobox.value).toBe('Dependência externa');
    });
  });

  // Property 1: Renderização do Card_de_Task é fiel ao item recebido
  // Validates: Requirements 1.1, 1.2, 1.7, 2.1, 2.2, 2.7, 10.3
  it('Feature: melhorias-acordos, Property 1: Renderização do Card_de_Task é fiel ao item recebido', () => {
    // numTentativas cobre os limites 0 e 9999 (Requisito 1.2) além do intervalo geral.
    const numTentativasArb = fc.oneof(
      fc.constant(0),
      fc.constant(9999),
      fc.integer({ min: 0, max: 9999 }),
    );
    // Nomes de motivo de 1 a 100 caracteres (Requisito 2.1); `undefined` representa
    // a ausência de Ultimo_Motivo_Informado (Requisito 2.2, 2.7).
    const motivoNomeArb = fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined });
    const estadoArb = fc.constantFrom<'pendente' | 'cumprido' | 'nao_cumprido'>(
      'pendente',
      'cumprido',
      'nao_cumprido',
    );

    const itemGeradoArb = fc.oneof(
      fc.record({
        grupo: fc.constant<'nova'>('nova'),
        titulo: fc.string({ minLength: 1, maxLength: 50 }),
      }),
      fc.record({
        grupo: fc.constant<'comAcordo'>('comAcordo'),
        numTentativas: numTentativasArb,
        ultimoMotivoNome: motivoNomeArb,
        estadoCumprimentoAcordoAtual: estadoArb,
      }),
    );

    fc.assert(
      fc.property(itemGeradoArb, (gerado) => {
        if (gerado.grupo === 'nova') {
          const { unmount } = render(<TaskCard item={criarTaskNova({ titulo: gerado.titulo })} />);

          try {
            // Requisito 1.7: Task_Nova nunca exibe o Campo_Numero_de_Tentativas.
            expect(screen.queryByTestId('task-card-num-tentativas')).not.toBeInTheDocument();
            // Task_Nova também nunca exibe o Campo_Ultimo_Motivo.
            expect(screen.queryByTestId('task-card-ultimo-motivo')).not.toBeInTheDocument();
          } finally {
            unmount();
          }
          return;
        }

        const { numTentativas, ultimoMotivoNome, estadoCumprimentoAcordoAtual } = gerado;
        const item = criarTaskComAcordo({
          numTentativas,
          ultimoMotivoNome,
          estadoCumprimentoAcordoAtual,
        });
        const { unmount } = render(<TaskCard item={item} />);

        try {
          // Requisito 1.1: "Registrado em" é exibido para toda Task_Com_Acordo.
          expect(screen.getByText(/Registrado em:/i)).toBeInTheDocument();

          // Requisitos 1.1, 1.2, 10.3: Campo_Numero_de_Tentativas exibe o valor
          // exato recebido, íntegro (inclusive zero), sem recálculo no frontend.
          // (Não usa `.trim()` no texto do campo: o valor exibido deve ser
          // comparado literalmente, sem descartar espaços que façam parte do
          // próprio valor recebido, ainda que numTentativas nunca os contenha.)
          const campoTentativas = screen.getByTestId('task-card-num-tentativas');
          expect(campoTentativas.textContent).toBe(`Nº de tentativas: ${numTentativas}`);

          // Requisitos 2.1, 2.2, 2.7, 10.3: Campo_Ultimo_Motivo exibe o nome exato
          // quando presente (inclusive espaços que façam parte do nome — daí não
          // usar `.trim()` aqui) e o Acordo_Atual não está `cumprido`; fica
          // ausente (com o rótulo) quando não houver motivo ou quando o
          // Acordo_Atual está `cumprido`.
          if (ultimoMotivoNome !== undefined && estadoCumprimentoAcordoAtual !== 'cumprido') {
            const campoMotivo = screen.getByTestId('task-card-ultimo-motivo');
            expect(campoMotivo.textContent).toBe(
              `Último motivo informado: ${ultimoMotivoNome}`,
            );
          } else {
            expect(screen.queryByTestId('task-card-ultimo-motivo')).not.toBeInTheDocument();
          }
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 },
    );
  });

  // Property 2: Mensagens de alerta não contêm contadores
  // Validates: Requirements 1.4, 1.5, 1.6
  it('Feature: melhorias-acordos, Property 2: Mensagens de alerta não contêm contadores', () => {
    // Contadores cobrindo os limites (0, 2, 3, 9999) além do intervalo geral —
    // o valor do contador não deve aparecer embutido no texto do alerta.
    const contadorArb = fc.oneof(
      fc.constant(0),
      fc.constant(2),
      fc.constant(3),
      fc.constant(9999),
      fc.integer({ min: 0, max: 9999 }),
    );

    // Ao menos um dos dois alertas precisa estar ativo para que exista uma
    // mensagem de alerta a ser verificada.
    const alertasArb = fc
      .record({
        alerta: fc.boolean(),
        alertaTentativasAvaliarPlanejar: fc.boolean(),
        numTentativas: contadorArb,
        tentativasAvaliarPlanejar: contadorArb,
      })
      .filter((valores) => valores.alerta || valores.alertaTentativasAvaliarPlanejar);

    fc.assert(
      fc.property(alertasArb, (valores) => {
        const item = criarTaskComAcordo(valores);
        const { unmount } = render(<TaskCard item={item} />);

        try {
          // Requisitos 1.4, 1.5, 1.6: cada mensagem de alerta ("Alerta: Acordo
          // não cumprido" e "Alerta: número de tentativas de 'Avaliar e
          // planejar' alto") é verificada isoladamente (pelo próprio elemento
          // `role="status"`, não pelo card inteiro) e não deve conter nenhum
          // caractere numérico — o Campo_Numero_de_Tentativas é a única
          // origem do valor do Nº_Tentativas, verificado separadamente pela
          // Property 1.
          const elementosDeAlerta = screen.getAllByRole('status');
          expect(elementosDeAlerta.length).toBeGreaterThan(0);
          for (const elemento of elementosDeAlerta) {
            expect(elemento.textContent ?? '').not.toMatch(/\d/);
          }
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 },
    );
  });

  describe('Finalizar', () => {
    it('exibe o botão "Finalizar" apenas para Task_Com_Acordo quando onAcordoAlterado é informado', () => {
      const { rerender } = render(
        <TaskCard item={criarTaskComAcordo()} onAcordoAlterado={vi.fn()} />,
      );
      expect(screen.getByTestId('task-card-finalizar')).toBeInTheDocument();

      rerender(<TaskCard item={criarTaskNova()} onAcordoAlterado={vi.fn()} />);
      expect(screen.queryByTestId('task-card-finalizar')).not.toBeInTheDocument();
    });

    it('não exibe o botão quando onAcordoAlterado não é informado', () => {
      render(<TaskCard item={criarTaskComAcordo()} />);
      expect(screen.queryByTestId('task-card-finalizar')).not.toBeInTheDocument();
    });

    it('chama finalizarTask com o id da Task e onAcordoAlterado ao clicar no botão', async () => {
      finalizarTask.mockResolvedValue({
        id: 'acordo-1',
        taskId: 'task-acordo-1',
        tipoAcordoId: 'tipo-1',
        dataRegistro: '2024-05-11T10:00:00.000Z',
        estadoCumprimento: 'cumprido',
        motivoNaoCumprimentoId: null,
      });
      const onAcordoAlterado = vi.fn();

      render(
        <TaskCard item={criarTaskComAcordo({ id: 'task-acordo-1' })} onAcordoAlterado={onAcordoAlterado} />,
      );

      fireEvent.click(screen.getByTestId('task-card-finalizar'));

      expect(finalizarTask).toHaveBeenCalledWith('task-acordo-1');
      await waitFor(() => expect(onAcordoAlterado).toHaveBeenCalled());
    });

    it('exibe erro e não chama onAcordoAlterado quando a API rejeita', async () => {
      finalizarTask.mockRejectedValue(
        new ApiError(409, 'SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.'),
      );
      const onAcordoAlterado = vi.fn();

      render(<TaskCard item={criarTaskComAcordo()} onAcordoAlterado={onAcordoAlterado} />);

      fireEvent.click(screen.getByTestId('task-card-finalizar'));

      expect(await screen.findByTestId('task-card-erro-finalizar')).toHaveTextContent(
        'A Task não possui Acordo_Atual.',
      );
      expect(onAcordoAlterado).not.toHaveBeenCalled();
    });
  });

  // Property 23: Pré-seleção do Responsável nos formulários
  // Validates: Requirements 9.1, 9.4, 9.6, 9.7
  // Cobre o formulário de edição de Task (RegistrarAcordoForm.test.tsx cobre
  // o Seletor_de_Responsavel do formulário de registro de Acordo).
  it('Feature: melhorias-acordos, Property 23: Pré-seleção do Responsável no formulário de edição de Task', async () => {
    const usuarioArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim() !== ''),
      nomeLogin: fc.string({ minLength: 1, maxLength: 20 }),
    });
    const usuariosArb = fc.uniqueArray(usuarioArb, {
      selector: (usuario) => usuario.id,
      maxLength: 5,
    });

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
        responsavelId: fc.oneof(fc.constant(undefined), idPertencenteArb, idInexistenteArb),
      });
    });

    await fc.assert(
      fc.asyncProperty(casoArb, async ({ usuarios, responsavelId }) => {
        listarUsuarios.mockReset().mockResolvedValue(usuarios);

        const { unmount } = render(
          <TaskCard
            item={criarTaskNova({ responsavelId })}
            onTaskEditada={vi.fn()}
          />,
        );

        fireEvent.click(screen.getByTestId('task-card-editar'));

        const selectResponsavel = (await screen.findByTestId(
          'task-card-editar-responsavel',
        )) as HTMLSelectElement;
        await waitFor(() => expect(listarUsuarios).toHaveBeenCalled());

        // Requisitos 9.6, 9.7: o Seletor_de_Responsavel do formulário de
        // edição de Task inicia com o Usuário correspondente ao
        // `responsavelId` do item selecionado somente quando esse id
        // pertence à lista carregada; caso contrário (ou sem
        // `responsavelId`), inicia vazio.
        const pertenceAoCadastro =
          responsavelId !== undefined && usuarios.some((usuario) => usuario.id === responsavelId);

        await waitFor(() =>
          expect(selectResponsavel.value).toBe(pertenceAoCadastro ? responsavelId : ''),
        );

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  // Property 18: Disponibilidade das ações do Card_de_Task
  // Validates: Requirements 5.1, 5.4, 5.6, 8.6
  it('Feature: melhorias-acordos, Property 18: Disponibilidade das ações do Card_de_Task', () => {
    // Nomes de Tipo_de_Acordo cobrindo o caso especial "Avaliar e
    // planejar" (Requisitos 5.4, 5.6) e outros valores quaisquer.
    const tipoAcordoNomeArb = fc.oneof(
      fc.constant('Avaliar e planejar'),
      fc
        .string({ minLength: 1, maxLength: 30 })
        .filter((valor) => valor !== 'Avaliar e planejar'),
    );
    const estadoArb = fc.constantFrom<'pendente' | 'cumprido' | 'nao_cumprido'>(
      'pendente',
      'cumprido',
      'nao_cumprido',
    );

    listarMotivos.mockResolvedValue([]);

    fc.assert(
      fc.property(tipoAcordoNomeArb, estadoArb, (tipoAcordoNome, estadoCumprimentoAcordoAtual) => {
        const item = criarTaskComAcordo({ tipoAcordoNome, estadoCumprimentoAcordoAtual });
        const { unmount } = render(<TaskCard item={item} onAcordoAlterado={vi.fn()} />);

        try {
          const ehAvaliarPlanejar = tipoAcordoNome === 'Avaliar e planejar';

          // Requisitos 5.1, 5.4, 5.6: a ação "Marcar como não cumprido" é
          // ocultada quando o Tipo_de_Acordo do Acordo_Atual é "Avaliar e
          // planejar", e exibida (habilitada) nos demais casos.
          const botaoMarcarNaoCumprido = screen.queryByTestId('task-card-marcar-nao-cumprido');
          if (ehAvaliarPlanejar) {
            expect(botaoMarcarNaoCumprido).not.toBeInTheDocument();
          } else {
            expect(botaoMarcarNaoCumprido).toBeInTheDocument();
            expect(botaoMarcarNaoCumprido).not.toBeDisabled();

            // Clicar no botão abre o Modal_de_Motivo, sem disparar
            // chamada à API diretamente.
            fireEvent.click(botaoMarcarNaoCumprido!);
            expect(screen.getByTestId('motivo-modal')).toBeInTheDocument();
            expect(avaliarAcordoAtual).not.toHaveBeenCalled();
          }

          // Requisito 8.6: o botão "Avaliar" (e o AvaliarAcordoForm) não
          // existe mais.
          expect(screen.queryByTestId('task-card-avaliar')).not.toBeInTheDocument();
          const botaoAvaliarExato = screen
            .queryAllByRole('button')
            .find((botao) => botao.textContent?.trim() === 'Avaliar');
          expect(botaoAvaliarExato).toBeUndefined();
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('abre o Modal_de_Motivo de "Marcar como não cumprido" com o Ultimo_Motivo_Informado pré-selecionado', async () => {
    listarMotivos.mockResolvedValue([]);

    render(
      <TaskCard
        item={criarTaskComAcordo({ ultimoMotivoNome: 'Bloqueado por dependência' })}
        onAcordoAlterado={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('task-card-marcar-nao-cumprido'));

    const combobox = (await screen.findByTestId('motivo-modal-combobox')) as HTMLInputElement;
    expect(combobox.value).toBe('Bloqueado por dependência');
  });

  // Property 24: Disponibilidade da ação "Repetir último acordo"
  it('Feature: melhorias-acordos, Property 24: Disponibilidade da ação "Repetir último acordo"', () => {
    const tipoAcordoNomeArb = fc.oneof(
      fc.constant('Avaliar e planejar'),
      fc
        .string({ minLength: 1, maxLength: 30 })
        .filter((valor) => valor !== 'Avaliar e planejar'),
    );
    const estadoArb = fc.constantFrom<'pendente' | 'cumprido' | 'nao_cumprido'>(
      'pendente',
      'cumprido',
      'nao_cumprido',
    );

    fc.assert(
      fc.property(tipoAcordoNomeArb, estadoArb, (tipoAcordoNome, estadoCumprimentoAcordoAtual) => {
        const item = criarTaskComAcordo({ tipoAcordoNome, estadoCumprimentoAcordoAtual });
        const { unmount } = render(<TaskCard item={item} onAcordoAlterado={vi.fn()} />);

        try {
          const exibido =
            tipoAcordoNome === 'Avaliar e planejar' || estadoCumprimentoAcordoAtual === 'nao_cumprido';

          if (exibido) {
            expect(screen.getByTestId('task-card-repetir-ultimo-acordo')).toBeInTheDocument();
          } else {
            expect(screen.queryByTestId('task-card-repetir-ultimo-acordo')).not.toBeInTheDocument();
          }
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 },
    );
  });

  // Property 12: Decisão de apresentar o Modal_de_Motivo na repetição
  // Validates: Requirements 4.1, 4.4
  it('Feature: melhorias-acordos, Property 12: Decisão de apresentar o Modal_de_Motivo na repetição', () => {
    // tipoAcordoNome cobrindo o caso especial "Avaliar e planejar" e
    // outros valores quaisquer (Requisitos 4.1, 4.4).
    const tipoAcordoNomeArb = fc.oneof(
      fc.constant('Avaliar e planejar'),
      fc
        .string({ minLength: 1, maxLength: 30 })
        .filter((valor) => valor !== 'Avaliar e planejar'),
    );

    // tentativasAvaliarPlanejar cobrindo explicitamente 0, 1 e 2 (limite
    // de decisão do Requisito 4.4) além de valores altos e do intervalo
    // geral.
    const tentativasAvaliarPlanejarArb = fc.oneof(
      fc.constant(0),
      fc.constant(1),
      fc.constant(2),
      fc.constant(9999),
      fc.integer({ min: 0, max: 9999 }),
    );

    listarMotivos.mockResolvedValue([]);

    fc.assert(
      fc.property(
        tipoAcordoNomeArb,
        tentativasAvaliarPlanejarArb,
        (tipoAcordoNome, tentativasAvaliarPlanejar) => {
          repetirUltimoAcordo.mockReset().mockResolvedValue({
            id: 'acordo-novo',
            taskId: 'task-acordo-1',
            tipoAcordoId: 'tipo-1',
            dataRegistro: '2024-05-11T10:00:00.000Z',
            estadoCumprimento: 'pendente',
            motivoNaoCumprimentoId: null,
          });
          const onAcordoAlterado = vi.fn();

          // O botão só é exibido quando o tipo é "Avaliar e planejar" ou
          // quando o Acordo_Atual está `nao_cumprido`; aqui fixamos
          // `nao_cumprido` para tipos diferentes de "Avaliar e planejar",
          // garantindo que o botão esteja sempre visível e permitindo
          // exercitar a decisão de apresentar o Modal_de_Motivo isolada
          // da decisão de exibir o botão (cobrida pela Property 24).
          const item = criarTaskComAcordo({
            id: 'task-acordo-1',
            tipoAcordoNome,
            tentativasAvaliarPlanejar,
            estadoCumprimentoAcordoAtual:
              tipoAcordoNome === 'Avaliar e planejar' ? 'pendente' : 'nao_cumprido',
          });
          const { unmount } = render(
            <TaskCard item={item} onAcordoAlterado={onAcordoAlterado} />,
          );

          try {
            fireEvent.click(screen.getByTestId('task-card-repetir-ultimo-acordo'));

            // Requisitos 4.1, 4.4: o Modal_de_Motivo é apresentado quando o
            // Tipo_de_Acordo do Acordo_Atual é diferente de "Avaliar e
            // planejar", ou quando é "Avaliar e planejar" com
            // tentativasAvaliarPlanejar >= 2; nos demais casos a API de
            // repetição é chamada diretamente, sem modal.
            const exigeModal =
              tipoAcordoNome !== 'Avaliar e planejar' || tentativasAvaliarPlanejar >= 2;

            if (exigeModal) {
              expect(screen.getByTestId('motivo-modal')).toBeInTheDocument();
              expect(repetirUltimoAcordo).not.toHaveBeenCalled();
            } else {
              expect(screen.queryByTestId('motivo-modal')).not.toBeInTheDocument();
              expect(repetirUltimoAcordo).toHaveBeenCalledWith('task-acordo-1');
            }
          } finally {
            unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
