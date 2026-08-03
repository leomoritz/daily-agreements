import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MotivoModal } from './MotivoModal';
import { ApiError } from '../api/errors';
import type { MotivoNaoCumprimento } from '../api/types';

const { listarMotivos } = vi.hoisted(() => ({
  listarMotivos: vi.fn(),
}));

vi.mock('../api/client', () => ({
  listarMotivos,
}));

/** Cria uma Promise controlável externamente, para simular submissões pendentes. */
function criarPromiseControlavel<T>() {
  let resolve!: (valor: T) => void;
  let reject!: (erro: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Property 5: O Combobox_de_Motivo oferece exatamente o cadastro
// Validates: Requirements 3.2
describe('MotivoModal', () => {
  beforeEach(() => {
    listarMotivos.mockReset().mockResolvedValue([]);
  });

  it('Feature: melhorias-acordos, Property 5: O Combobox_de_Motivo oferece exatamente o cadastro', async () => {
    // Nomes não vazios após trim, únicos por id (o Cadastro_de_Motivos_de_Nao_Cumprimento
    // não impõe unicidade de texto no gerador — o Requisito 3.2 exige apenas que a
    // datalist reproduza exatamente o cadastro, cadastro vazio inclusive).
    const motivoArb = fc.record({
      id: fc.uuid(),
      nome: fc.string({ minLength: 1, maxLength: 100 }),
    });

    // Cobre cadastro vazio, unitário e grande (até 200 itens) num único gerador.
    const cadastroArb = fc.uniqueArray(motivoArb, {
      selector: (m) => m.id,
      minLength: 0,
      maxLength: 200,
    });

    await fc.assert(
      fc.asyncProperty(cadastroArb, async (cadastro: MotivoNaoCumprimento[]) => {
        listarMotivos.mockReset().mockResolvedValue(cadastro);

        const { unmount } = render(
          <MotivoModal titulo="Marcar como não cumprido" onConfirmar={vi.fn()} onCancelar={vi.fn()} />,
        );

        // Aguarda o carregamento assíncrono do Cadastro_de_Motivos_de_Nao_Cumprimento
        // terminar de popular a datalist.
        await waitFor(() => expect(listarMotivos).toHaveBeenCalledTimes(1));

        const datalist = await screen.findByTestId('motivo-modal-datalist');
        const opcoes = Array.from(datalist.querySelectorAll('option')).map(
          (option) => (option as HTMLOptionElement).value,
        );

        // Exatamente todos os nomes do cadastro, sem faltar, sem duplicar e sem
        // nenhum valor que não pertença ao cadastro (Requisito 3.2).
        expect(opcoes).toHaveLength(cadastro.length);
        expect([...opcoes].sort()).toEqual([...cadastro.map((m) => m.nome)].sort());

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  // Requisito 3.1: abre com o Combobox_de_Motivo sem seleção e sem texto,
  // sem submeter nenhuma requisição além do carregamento do cadastro.
  it('abre com o Combobox_de_Motivo vazio e sem submeter nenhuma requisição (Requisito 3.1)', async () => {
    const onConfirmar = vi.fn();

    render(
      <MotivoModal titulo="Marcar como não cumprido" onConfirmar={onConfirmar} onCancelar={vi.fn()} />,
    );

    await waitFor(() => expect(listarMotivos).toHaveBeenCalledTimes(1));

    const combobox = screen.getByTestId('motivo-modal-combobox') as HTMLInputElement;
    expect(combobox.value).toBe('');
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  // Requisito 3.7/4.7: cancelar (botão ou Esc) apenas fecha o modal, sem
  // submeter nada.
  it('cancela pelo botão sem chamar onConfirmar (Requisitos 3.7, 4.7)', async () => {
    const onConfirmar = vi.fn();
    const onCancelar = vi.fn();

    render(<MotivoModal titulo="Marcar como não cumprido" onConfirmar={onConfirmar} onCancelar={onCancelar} />);

    await waitFor(() => expect(listarMotivos).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('motivo-modal-cancelar'));

    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it('cancela pela tecla Esc sem chamar onConfirmar (Requisitos 3.7, 4.7)', async () => {
    const onConfirmar = vi.fn();
    const onCancelar = vi.fn();

    render(<MotivoModal titulo="Marcar como não cumprido" onConfirmar={onConfirmar} onCancelar={onCancelar} />);

    await waitFor(() => expect(listarMotivos).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(screen.getByTestId('motivo-modal-overlay'), { key: 'Escape' });

    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  // Requisito 3.10/4.10: enquanto a confirmação está pendente, as ações de
  // confirmar e cancelar ficam indisponíveis, garantindo no máximo uma
  // submissão por confirmação.
  it('duplo-clique em Confirmar com submissão pendente resulta em exatamente uma chamada a onConfirmar (Requisitos 3.10, 4.10)', async () => {
    const { promise, resolve } = criarPromiseControlavel<void>();
    const onConfirmar = vi.fn().mockReturnValue(promise);
    const onCancelar = vi.fn();

    render(<MotivoModal titulo="Marcar como não cumprido" onConfirmar={onConfirmar} onCancelar={onCancelar} />);

    await waitFor(() => expect(listarMotivos).toHaveBeenCalledTimes(1));

    const confirmar = screen.getByTestId('motivo-modal-confirmar');
    const cancelar = screen.getByTestId('motivo-modal-cancelar');

    fireEvent.click(confirmar);
    fireEvent.click(confirmar);

    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(confirmar).toBeDisabled();
    expect(cancelar).toBeDisabled();

    // Cancelar também fica indisponível enquanto pendente.
    fireEvent.click(cancelar);
    expect(onCancelar).not.toHaveBeenCalled();

    resolve();
    await waitFor(() => expect(confirmar).not.toBeDisabled());
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  // Requisito 3.9/4.8: rejeição da API mantém o modal aberto, preserva o
  // texto digitado e exibe a mensagem de erro.
  it('rejeição da API mantém o modal aberto, preserva o texto digitado e exibe o erro (Requisitos 3.9, 4.8)', async () => {
    const erro = new ApiError(409, 'ACORDO_ATUAL_INDISPONIVEL', 'Não existe Acordo_Atual pendente de avaliação.');
    const onConfirmar = vi.fn().mockRejectedValue(erro);
    const onCancelar = vi.fn();

    render(<MotivoModal titulo="Marcar como não cumprido" onConfirmar={onConfirmar} onCancelar={onCancelar} />);

    await waitFor(() => expect(listarMotivos).toHaveBeenCalledTimes(1));

    const combobox = screen.getByTestId('motivo-modal-combobox') as HTMLInputElement;
    fireEvent.change(combobox, { target: { value: 'Bloqueado por dependência' } });
    fireEvent.click(screen.getByTestId('motivo-modal-confirmar'));

    const mensagemErro = await screen.findByTestId('motivo-modal-erro');
    expect(mensagemErro).toHaveTextContent('Não existe Acordo_Atual pendente de avaliação.');

    // Modal permanece aberto e o texto digitado é preservado.
    expect(screen.getByTestId('motivo-modal')).toBeInTheDocument();
    expect(combobox.value).toBe('Bloqueado por dependência');
    expect(onCancelar).not.toHaveBeenCalled();
  });

  // Requisito 3.9: o timeout de 30s é traduzido pelo wrapper de fetch em uma
  // Promise rejeitada — o modal trata essa rejeição da mesma forma que
  // qualquer outra rejeição da API (mantém aberto, preserva texto, exibe erro).
  it('timeout de 30s (rejeição da Promise) é tratado como rejeição, preservando o texto e exibindo erro (Requisito 3.9)', async () => {
    const erroTimeout = new ApiError(504, 'TIMEOUT', 'Tempo de resposta da API excedido.');
    const onConfirmar = vi.fn().mockRejectedValue(erroTimeout);
    const onCancelar = vi.fn();

    render(<MotivoModal titulo="Repetir último acordo" onConfirmar={onConfirmar} onCancelar={onCancelar} />);

    await waitFor(() => expect(listarMotivos).toHaveBeenCalledTimes(1));

    const combobox = screen.getByTestId('motivo-modal-combobox') as HTMLInputElement;
    fireEvent.change(combobox, { target: { value: 'Aguardando revisão' } });
    fireEvent.click(screen.getByTestId('motivo-modal-confirmar'));

    const mensagemErro = await screen.findByTestId('motivo-modal-erro');
    expect(mensagemErro).toHaveTextContent('Tempo de resposta da API excedido.');

    expect(screen.getByTestId('motivo-modal')).toBeInTheDocument();
    expect(combobox.value).toBe('Aguardando revisão');
    expect(onCancelar).not.toHaveBeenCalled();
  });

  // Bugfix: com `motivoInicial` pré-preenchido, o `<datalist>` nativo
  // filtra as opções exibidas pelo texto corrente do input — sem limpar
  // esse valor ao focar o campo, abrir a lista só mostraria motivos que
  // contêm o texto pré-preenchido, escondendo os demais e impedindo o
  // usuário de trocar de motivo sem apagar manualmente o que está escrito.
  it('limpa o valor pré-preenchido ao focar o campo, permitindo ver todos os motivos (Requisito 3.1)', async () => {
    listarMotivos.mockResolvedValue([
      { id: 'm1', nome: 'Dependência externa' },
      { id: 'm2', nome: 'Problema ambiente' },
    ]);

    render(
      <MotivoModal
        titulo="Marcar como não cumprido"
        motivoInicial="Dependência externa"
        onConfirmar={vi.fn()}
        onCancelar={vi.fn()}
      />,
    );

    await waitFor(() => expect(listarMotivos).toHaveBeenCalledTimes(1));

    const combobox = screen.getByTestId('motivo-modal-combobox') as HTMLInputElement;
    // O foco automático inicial (Requisito 3.1) não deve limpar o valor.
    expect(combobox.value).toBe('Dependência externa');

    // Simula o usuário clicando/focando o campo novamente (um segundo
    // foco, distinto do automático): o valor pré-preenchido é limpo para
    // que a lista completa de motivos fique visível.
    fireEvent.blur(combobox);
    fireEvent.focus(combobox);
    expect(combobox.value).toBe('');

    // Perder o foco sem digitar nem selecionar nada restaura o valor
    // original em vez de deixar o campo vazio.
    fireEvent.blur(combobox);
    expect(combobox.value).toBe('Dependência externa');
  });

  it('mantém o campo vazio ao focar novamente após o usuário editar o valor pré-preenchido', async () => {
    listarMotivos.mockResolvedValue([]);

    render(
      <MotivoModal
        titulo="Marcar como não cumprido"
        motivoInicial="Dependência externa"
        onConfirmar={vi.fn()}
        onCancelar={vi.fn()}
      />,
    );

    await waitFor(() => expect(listarMotivos).toHaveBeenCalledTimes(1));

    const combobox = screen.getByTestId('motivo-modal-combobox') as HTMLInputElement;

    fireEvent.change(combobox, { target: { value: 'Novo motivo digitado' } });
    fireEvent.blur(combobox);
    fireEvent.focus(combobox);

    // Já não é mais o valor "automático": foco/blur não devem apagar ou
    // restaurar nada além do que o usuário digitou.
    expect(combobox.value).toBe('Novo motivo digitado');
  });
});
